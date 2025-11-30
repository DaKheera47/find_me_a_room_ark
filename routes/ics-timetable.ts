import { Router } from "express";
import { getDatabase } from "../scripts/db";
import { format, parse, addWeeks, isBefore } from "date-fns";
import { readBuildingsFromCSV } from "../scraping";

const icsRouter = Router();

// Cache for buildings data
let buildingsCache: Array<{ name: string; address: string; code: string }> | null = null;

async function getBuildings() {
    if (!buildingsCache) {
        const buildings = await readBuildingsFromCSV("./static/preston_buildings.csv");
        buildingsCache = buildings.map(b => ({ name: b.name, address: b.address, code: b.code }));
    }
    return buildingsCache;
}

/**
 * Get location string for ICS event
 */
async function getLocationString(roomName: string, buildingCode: string): Promise<string> {
    const buildings = await getBuildings();
    const building = buildings.find(b => b.code === buildingCode);
    if (building) {
        return `${roomName}, ${building.name}`;
    }
    return roomName;
}

interface TimetableEvent {
    id: number;
    roomName: string;
    buildingCode: string;
    day: string;
    startDateString: string;
    endDateString: string;
    time: string;
    moduleCode: string;
    moduleName: string;
    module: string;
    lecturer: string;
    group: string;
    sessionType: string;
}

interface ModuleGroup {
    moduleCode: string;
    groups: string[];
}

/**
 * GET /modules/:moduleCode/groups
 * Returns all unique groups for a specific module
 */
icsRouter.get("/modules/:moduleCode/groups", async (req, res) => {
    try {
        const moduleCode = decodeURIComponent(req.params.moduleCode || "").toUpperCase();

        if (!moduleCode) {
            return res.status(400).json({ error: "Missing module code" });
        }

        const db = getDatabase();

        if (!db) {
            return res.status(503).json({
                error: "Database not available. Please run the scraper first.",
            });
        }

        // Get all unique groups for this module
        const groups = db
            .prepare(
                `
                SELECT DISTINCT group_type as "group"
                FROM events 
                WHERE module_code = ? AND group_type IS NOT NULL AND group_type != ''
                ORDER BY group_type ASC
            `
            )
            .all(moduleCode) as Array<{ group: string }>;

        // Get total session count for this module (regardless of group)
        const sessionCount = db
            .prepare(
                `
                SELECT COUNT(*) as count
                FROM events 
                WHERE module_code = ?
            `
            )
            .get(moduleCode) as { count: number };

        db.close();

        res.json({
            moduleCode,
            groups: groups.map((g) => g.group),
            count: groups.length,
            sessionCount: sessionCount.count,
        });
    } catch (error) {
        console.error("Failed to load groups for module", error);
        res.status(500).json({ error: "Failed to load groups" });
    }
});

/**
 * POST /timetable/preview
 * Returns timetable entries for selected modules and their groups
 * Body: { selections: [{ moduleCode: string, groups: string[] }] }
 */
icsRouter.post("/timetable/preview", async (req, res) => {
    try {
        const { selections } = req.body as {
            selections: Array<{ moduleCode: string; groups: string[] }>;
        };

        if (!selections || !Array.isArray(selections) || selections.length === 0) {
            return res.status(400).json({ error: "Missing or invalid selections" });
        }

        const db = getDatabase();

        if (!db) {
            return res.status(503).json({
                error: "Database not available. Please run the scraper first.",
            });
        }

        const allEvents: TimetableEvent[] = [];

        for (const selection of selections) {
            const { moduleCode, groups } = selection;

            if (!moduleCode) continue;

            let query = `
                SELECT 
                    e.id,
                    e.room_name as roomName,
                    e.building_code as buildingCode,
                    e.day,
                    e.start_time as startDateString,
                    e.end_time as endDateString,
                    e.time_display as time,
                    e.module_code as moduleCode,
                    e.module_name as moduleName,
                    e.module_raw as module,
                    e.lecturer_raw as lecturer,
                    e.group_type as "group"
                FROM events e
                WHERE e.module_code = ?
            `;

            const params: (string | number)[] = [moduleCode.toUpperCase()];

            // If groups are specified, filter by them
            if (groups && groups.length > 0) {
                const placeholders = groups.map(() => "?").join(", ");
                query += ` AND e.group_type IN (${placeholders})`;
                params.push(...groups);
            }

            query += ` ORDER BY e.start_time ASC`;

            const events = db.prepare(query).all(...params) as TimetableEvent[];
            allEvents.push(...events);
        }

        // Get metadata
        const metadata = db
            .prepare(`SELECT value FROM scrape_metadata WHERE key = 'scrape_completed'`)
            .get() as { value: string } | undefined;

        db.close();

        // Sort all events by start time
        allEvents.sort(
            (a, b) => new Date(a.startDateString).getTime() - new Date(b.startDateString).getTime()
        );

        res.json({
            events: allEvents.map((e) => ({
                id: e.id,
                roomName: e.roomName,
                buildingCode: e.buildingCode,
                day: e.day,
                startDateString: e.startDateString,
                endDateString: e.endDateString,
                time: e.time,
                moduleCode: e.moduleCode,
                moduleName: e.moduleName,
                module: e.module,
                lecturer: e.lecturer || "",
                group: e.group || "",
            })),
            count: allEvents.length,
            generatedAt: metadata?.value || null,
        });
    } catch (error) {
        console.error("Failed to generate timetable preview", error);
        res.status(500).json({ error: "Failed to generate timetable preview" });
    }
});

/**
 * Generate a unique hash for the selections to use as calendar ID
 */
function generateCalendarId(selections: Array<{ moduleCode: string; groups: string[] }>): string {
    const normalized = selections
        .map((s) => `${s.moduleCode}:${s.groups.sort().join(",")}`)
        .sort()
        .join("|");

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

/**
 * Escape special characters for ICS format
 */
function escapeICS(str: string): string {
    if (!str) return "";
    return str
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\n/g, "\\n");
}

/**
 * Format date for ICS (YYYYMMDDTHHMMSS)
 */
function formatICSDate(dateStr: string): string {
    const date = new Date(dateStr);
    return format(date, "yyyyMMdd'T'HHmmss");
}

/**
 * GET /timetable/ics
 * Returns an ICS file for the given selections (encoded in query params)
 * Query: ?data=base64EncodedSelections
 */
icsRouter.get("/timetable/ics", async (req, res) => {
    try {
        const { data } = req.query;

        if (!data || typeof data !== "string") {
            return res.status(400).json({ error: "Missing data parameter" });
        }

        let selections: Array<{ moduleCode: string; groups: string[] }>;

        try {
            const decoded = Buffer.from(data, "base64").toString("utf-8");
            selections = JSON.parse(decoded);
        } catch {
            return res.status(400).json({ error: "Invalid data parameter" });
        }

        if (!selections || !Array.isArray(selections) || selections.length === 0) {
            return res.status(400).json({ error: "Invalid selections" });
        }

        const db = getDatabase();

        if (!db) {
            return res.status(503).json({
                error: "Database not available. Please run the scraper first.",
            });
        }

        const allEvents: TimetableEvent[] = [];

        for (const selection of selections) {
            const { moduleCode, groups } = selection;

            if (!moduleCode) continue;

            let query = `
                SELECT 
                    e.id,
                    e.room_name as roomName,
                    e.building_code as buildingCode,
                    e.day,
                    e.start_time as startDateString,
                    e.end_time as endDateString,
                    e.time_display as time,
                    e.module_code as moduleCode,
                    e.module_name as moduleName,
                    e.module_raw as module,
                    e.lecturer_raw as lecturer,
                    e.group_type as "group",
                    e.session_type as sessionType
                FROM events e
                WHERE e.module_code = ?
            `;

            const params: (string | number)[] = [moduleCode.toUpperCase()];

            if (groups && groups.length > 0) {
                const placeholders = groups.map(() => "?").join(", ");
                query += ` AND e.group_type IN (${placeholders})`;
                params.push(...groups);
            }

            const events = db.prepare(query).all(...params) as TimetableEvent[];
            allEvents.push(...events);
        }

        // Get metadata for last update time
        const metadata = db
            .prepare(`SELECT value FROM scrape_metadata WHERE key = 'scrape_completed'`)
            .get() as { value: string } | undefined;

        db.close();

        // Generate ICS content
        const calendarId = generateCalendarId(selections);
        const moduleNames = [...new Set(selections.map((s) => s.moduleCode))].join(", ");

        const icsLines: string[] = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Find Me A Room//Timetable Generator//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            `X-WR-CALNAME:UCLan Timetable - ${moduleNames}`,
            `X-WR-CALDESC:Auto-generated timetable for ${moduleNames}`,
        ];

        // Add each event
        for (const event of allEvents) {
            const uid = `${event.id}-${calendarId}@findmearoom.uclan`;
            const dtStart = formatICSDate(event.startDateString);
            const dtEnd = formatICSDate(event.endDateString);
            
            // Clean module name by removing content in brackets (e.g., "(Full Yr at Preston)")
            const rawModuleName = event.moduleName || event.module || event.moduleCode;
            const cleanedModuleName = rawModuleName.replace(/\s*\([^)]*\)\s*/g, "").trim();
            
            // Extract session type (Lecture, Practical, Lab, etc.) from sessionType field
            // sessionType is like "Lecture (On Campus)" or "Practical (On Campus)"
            let sessionTypeLabel = "Session";
            if (event.sessionType) {
                // Extract just the type part before any parentheses
                const typeMatch = event.sessionType.match(/^([^(]+)/);
                if (typeMatch) {
                    sessionTypeLabel = typeMatch[1].trim();
                }
            }
            
            // Format: NAME - TYPE - CODE (e.g., "Distributed Systems - Lecture - CO3404")
            const summary = `${cleanedModuleName} - ${sessionTypeLabel} - ${event.moduleCode}`;
            const location = await getLocationString(event.roomName, event.buildingCode);
            const descriptionParts = [
                event.lecturer ? `Lecturer: ${event.lecturer}` : "",
                event.group ? `Group: ${event.group}` : "",
                event.time ? `Time: ${event.time}` : "",
            ].filter(Boolean);
            // Use literal \n for ICS newlines in description
            const description = descriptionParts.join("\\n");

            icsLines.push(
                "BEGIN:VEVENT",
                `UID:${uid}`,
                `DTSTAMP:${format(new Date(), "yyyyMMdd'T'HHmmss'Z'")}`,
                `DTSTART:${dtStart}`,
                `DTEND:${dtEnd}`,
                `SUMMARY:${escapeICS(summary)}`,
                `LOCATION:${escapeICS(location)}`,
                `DESCRIPTION:${description}`,
                "END:VEVENT"
            );
        }

        icsLines.push("END:VCALENDAR");

        // Set headers for ICS download/subscription
        res.setHeader("Content-Type", "text/calendar; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="timetable-${calendarId}.ics"`);

        // Cache for 1 hour to balance freshness and performance
        res.setHeader("Cache-Control", "public, max-age=3600");

        res.send(icsLines.join("\r\n"));
    } catch (error) {
        console.error("Failed to generate ICS", error);
        res.status(500).json({ error: "Failed to generate ICS file" });
    }
});

/**
 * POST /timetable/generate-link
 * Generates a subscribable ICS link for the given selections
 * Body: { selections: [{ moduleCode: string, groups: string[] }] }
 */
icsRouter.post("/timetable/generate-link", async (req, res) => {
    try {
        const { selections } = req.body as {
            selections: Array<{ moduleCode: string; groups: string[] }>;
        };

        if (!selections || !Array.isArray(selections) || selections.length === 0) {
            return res.status(400).json({ error: "Missing or invalid selections" });
        }

        // Encode selections as base64
        const data = Buffer.from(JSON.stringify(selections)).toString("base64");

        // Generate the ICS URL
        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 8072}`;
        const icsUrl = `${baseUrl}/timetable/ics?data=${encodeURIComponent(data)}`;

        res.json({
            icsUrl,
            webcalUrl: icsUrl.replace(/^https?:/, "webcal:"),
            googleCalendarUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(icsUrl)}`,
            selections,
        });
    } catch (error) {
        console.error("Failed to generate ICS link", error);
        res.status(500).json({ error: "Failed to generate ICS link" });
    }
});

export default icsRouter;

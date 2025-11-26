import { Router } from "express";
import { getDatabase } from "../scripts/db";
import {
    extractLecturerNames,
    normaliseLecturerName,
    sortByStartDate,
} from "../scripts/lecturer-utils";
import { cleanBrackets } from "../utils";

const lecturersRouter = Router();

/**
 * GET /lecturers
 * Returns list of all lecturer names from the database
 */
lecturersRouter.get("/lecturers", async (req, res) => {
    try {
        const db = getDatabase();

        if (!db) {
            return res.status(503).json({
                error: "Database not available. Please run the scraper first.",
            });
        }

        // Get all lecturer names
        const lecturers = db
            .prepare(`SELECT name FROM lecturers ORDER BY name_lower ASC`)
            .all() as { name: string }[];

        // Get metadata
        const metadata = db
            .prepare(`SELECT key, value FROM scrape_metadata WHERE key IN ('scrape_completed', 'total_lecturers')`)
            .all() as { key: string; value: string }[];

        const metaMap = Object.fromEntries(metadata.map((m) => [m.key, m.value]));

        db.close();

        res.json({
            lecturers: lecturers.map((l) => l.name),
            count: lecturers.length,
            generatedAt: metaMap.scrape_completed || null,
        });
    } catch (error) {
        console.error("Failed to load lecturers from database", error);
        res.status(500).json({ error: "Failed to load lecturers" });
    }
});

/**
 * GET /lecturers/:lecturerName
 * Returns timetable for a specific lecturer
 */
lecturersRouter.get("/lecturers/:lecturerName", async (req, res) => {
    try {
        const rawLecturerName = req.params.lecturerName;
        const decodedName = decodeURIComponent(rawLecturerName || "");

        if (!decodedName) {
            return res.status(400).json({ error: "Missing lecturer name" });
        }

        const db = getDatabase();

        if (!db) {
            return res.status(503).json({
                error: "Database not available. Please run the scraper first.",
            });
        }

        // Try multiple lookup strategies
        let lecturer: { id: number; name: string } | undefined;

        // Strategy 1: Exact match on normalized name
        const cleanedCandidates = extractLecturerNames(decodedName);
        const lookupName = cleanedCandidates[0] ?? normaliseLecturerName(decodedName);
        const lookupKey = lookupName.toLowerCase();

        lecturer = db
            .prepare(`SELECT id, name FROM lecturers WHERE name_lower = ?`)
            .get(lookupKey) as { id: number; name: string } | undefined;

        // Strategy 2: If input is "firstname lastname", try "lastname, firstname"
        if (!lecturer) {
            const parts = decodedName.trim().split(/\s+/);
            if (parts.length === 2) {
                const [first, last] = parts;
                const flippedKey = `${last}, ${first}`.toLowerCase();
                lecturer = db
                    .prepare(`SELECT id, name FROM lecturers WHERE name_lower = ?`)
                    .get(flippedKey) as { id: number; name: string } | undefined;
            }
        }

        // Strategy 3: Fuzzy match - search for names containing all parts
        if (!lecturer) {
            const searchTerms = decodedName.toLowerCase().split(/\s+/).filter(Boolean);
            if (searchTerms.length > 0) {
                // Build a query that matches all terms anywhere in the name
                const conditions = searchTerms.map(() => `name_lower LIKE ?`).join(" AND ");
                const params = searchTerms.map(term => `%${term}%`);
                
                lecturer = db
                    .prepare(`SELECT id, name FROM lecturers WHERE ${conditions} LIMIT 1`)
                    .get(...params) as { id: number; name: string } | undefined;
            }
        }

        if (!lecturer) {
            db.close();
            return res.status(404).json({ error: `Lecturer ${decodedName} not found` });
        }

        // Get events for this lecturer
        const events = db
            .prepare(`
                SELECT 
                    e.room_name as roomName,
                    e.building_code as buildingCode,
                    e.day,
                    e.start_time as startDateString,
                    e.end_time as endDateString,
                    e.time_display as time,
                    e.module_code as moduleCode,
                    e.module_name as moduleName,
                    e.module_raw as module,
                    e.group_type as "group",
                    e.slot_index as slotInDay,
                    e.row_index as topIdx
                FROM events e
                JOIN event_lecturers el ON e.id = el.event_id
                WHERE el.lecturer_id = ?
                ORDER BY e.start_time ASC
            `)
            .all(lecturer.id) as Array<{
                roomName: string;
                buildingCode: string;
                day: string;
                startDateString: string;
                endDateString: string;
                time: string;
                moduleCode: string | null;
                moduleName: string | null;
                module: string;
                group: string;
                slotInDay: number;
                topIdx: number;
            }>;

        // Get metadata
        const metadata = db
            .prepare(`SELECT value FROM scrape_metadata WHERE key = 'scrape_completed'`)
            .get() as { value: string } | undefined;

        db.close();

        // Transform to match existing API format
        const timetable = events.map((e) => ({
            topIdx: e.topIdx,
            slotInDay: e.slotInDay,
            time: e.time,
            module: e.module,
            lecturer: lecturer.name,
            group: cleanBrackets(e.group),
            roomName: e.roomName,
            day: e.day,
            startDateString: e.startDateString,
            endDateString: e.endDateString,
        }));

        res.json({
            lecturer: lecturer.name,
            timetable: sortByStartDate(timetable),
            generatedAt: metadata?.value || null,
        });
    } catch (error) {
        console.error("Failed to load lecturer timetable", error);
        res.status(500).json({ error: "Failed to load lecturer timetable" });
    }
});

export default lecturersRouter;

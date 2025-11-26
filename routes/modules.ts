import { Router } from "express";
import { getDatabase } from "../scripts/db";

const modulesRouter = Router();

interface ModuleInfo {
    code: string;
    name: string;
    eventCount: number;
}

/**
 * GET /modules
 * Returns list of all unique modules from the database
 */
modulesRouter.get("/modules", async (req, res) => {
    try {
        const db = getDatabase();

        if (!db) {
            return res.status(503).json({
                error: "Database not available. Please run the scraper first.",
            });
        }

        // Get all unique modules with their event counts
        const modules = db
            .prepare(`
                SELECT 
                    module_code as code,
                    module_name as name,
                    COUNT(*) as eventCount
                FROM events 
                WHERE module_code IS NOT NULL AND module_code != ''
                GROUP BY module_code
                ORDER BY module_code ASC
            `)
            .all() as ModuleInfo[];

        // Get metadata
        const metadata = db
            .prepare(`SELECT value FROM scrape_metadata WHERE key = 'scrape_completed'`)
            .get() as { value: string } | undefined;

        db.close();

        res.json({
            modules: modules.map((m) => ({
                code: m.code,
                name: m.name || m.code,
                eventCount: m.eventCount,
            })),
            count: modules.length,
            generatedAt: metadata?.value || null,
        });
    } catch (error) {
        console.error("Failed to load modules from database", error);
        res.status(500).json({ error: "Failed to load modules" });
    }
});

/**
 * GET /modules/:moduleCode
 * Returns all timetable entries for a specific module
 */
modulesRouter.get("/modules/:moduleCode", async (req, res) => {
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

        // Get module info
        const moduleInfo = db
            .prepare(`
                SELECT 
                    module_code as code,
                    module_name as name
                FROM events 
                WHERE module_code = ?
                LIMIT 1
            `)
            .get(moduleCode) as { code: string; name: string } | undefined;

        if (!moduleInfo) {
            db.close();
            return res.status(404).json({ error: `Module ${moduleCode} not found` });
        }

        // Get all events for this module
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
                    e.lecturer_raw as lecturer,
                    e.group_type as "group",
                    e.slot_index as slotInDay,
                    e.row_index as topIdx
                FROM events e
                WHERE e.module_code = ?
                ORDER BY e.start_time ASC
            `)
            .all(moduleCode) as Array<{
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
            lecturer: e.lecturer || "",
            group: e.group || "",
            roomName: e.roomName,
            day: e.day,
            startDateString: e.startDateString,
            endDateString: e.endDateString,
        }));

        // Get unique lecturers for this module
        const uniqueLecturers = [...new Set(events.map(e => e.lecturer).filter(Boolean))];
        
        // Get unique session types
        const uniqueSessionTypes = [...new Set(events.map(e => e.group).filter(Boolean))];

        res.json({
            module: {
                code: moduleInfo.code,
                name: moduleInfo.name || moduleInfo.code,
            },
            timetable,
            summary: {
                totalSessions: timetable.length,
                lecturers: uniqueLecturers,
                sessionTypes: uniqueSessionTypes,
            },
            generatedAt: metadata?.value || null,
        });
    } catch (error) {
        console.error("Failed to load module timetable", error);
        res.status(500).json({ error: "Failed to load module timetable" });
    }
});

export default modulesRouter;

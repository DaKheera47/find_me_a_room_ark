/**
 * Database Query Helpers
 *
 * Provides functions to query the overnight-scraped database for use in API routes.
 * These replace the real-time scraping functions.
 */

import { getDatabase } from "./db";
import type Database from "better-sqlite3";

/**
 * Event row from the database
 */
interface DbEventRow {
    id: number;
    room_name: string;
    building_code: string;
    day: string;
    start_time: string;
    end_time: string;
    time_display: string | null;
    module_code: string | null;
    module_name: string | null;
    module_raw: string | null;
    lecturer_raw: string | null;
    group_type: string | null;
    session_type: string | null;
    slot_index: number | null;
    row_index: number | null;
    scraped_at: string;
}

/**
 * Convert a database event row to a TimetableEntry object
 */
function dbRowToTimetableEntry(row: DbEventRow): TimetableEntry {
    return {
        topIdx: row.row_index ?? 0,
        slotInDay: row.slot_index ?? 0,
        time: row.time_display ?? "",
        module: row.module_raw ?? "",
        lecturer: row.lecturer_raw ?? "",
        group: row.group_type ?? "",
        sessionType: row.session_type ?? "",
        roomName: row.room_name,
        day: row.day,
        startDateString: row.start_time,
        endDateString: row.end_time,
    };
}

/**
 * Get timetable entries for a specific room
 */
export function getRoomTimetable(roomName: string): TimetableEntry[] {
    const db = getDatabase();
    if (!db) {
        throw new Error("Database not available. Run overnight scrape first.");
    }

    try {
        const rows = db.prepare(`
            SELECT * FROM events
            WHERE room_name = ?
            ORDER BY start_time ASC
        `).all(roomName) as DbEventRow[];

        return rows.map(dbRowToTimetableEntry);
    } finally {
        db.close();
    }
}

/**
 * Get timetable entries for all rooms in a building
 */
export function getBuildingTimetables(buildingCode: string): Map<string, TimetableEntry[]> {
    const db = getDatabase();
    if (!db) {
        throw new Error("Database not available. Run overnight scrape first.");
    }

    try {
        const rows = db.prepare(`
            SELECT * FROM events
            WHERE building_code = ?
            ORDER BY room_name, start_time ASC
        `).all(buildingCode) as DbEventRow[];

        // Group by room name
        const result = new Map<string, TimetableEntry[]>();

        for (const row of rows) {
            const entry = dbRowToTimetableEntry(row);
            const existing = result.get(row.room_name);
            if (existing) {
                existing.push(entry);
            } else {
                result.set(row.room_name, [entry]);
            }
        }

        return result;
    } finally {
        db.close();
    }
}

/**
 * Get timetable entries for multiple rooms (by room names)
 */
export function getMultipleRoomTimetables(roomNames: string[]): Map<string, TimetableEntry[]> {
    if (roomNames.length === 0) {
        return new Map();
    }

    const db = getDatabase();
    if (!db) {
        throw new Error("Database not available. Run overnight scrape first.");
    }

    try {
        const placeholders = roomNames.map(() => "?").join(", ");
        const rows = db.prepare(`
            SELECT * FROM events
            WHERE room_name IN (${placeholders})
            ORDER BY room_name, start_time ASC
        `).all(...roomNames) as DbEventRow[];

        // Group by room name
        const result = new Map<string, TimetableEntry[]>();

        // Initialize with empty arrays for all requested rooms
        for (const roomName of roomNames) {
            result.set(roomName, []);
        }

        for (const row of rows) {
            const entry = dbRowToTimetableEntry(row);
            const existing = result.get(row.room_name);
            if (existing) {
                existing.push(entry);
            }
        }

        return result;
    } finally {
        db.close();
    }
}

/**
 * Get all unique room names in a building from the database
 */
export function getRoomsInBuilding(buildingCode: string): string[] {
    const db = getDatabase();
    if (!db) {
        throw new Error("Database not available. Run overnight scrape first.");
    }

    try {
        const rows = db.prepare(`
            SELECT DISTINCT room_name FROM events
            WHERE building_code = ?
            ORDER BY room_name
        `).all(buildingCode) as { room_name: string }[];

        return rows.map((r) => r.room_name);
    } finally {
        db.close();
    }
}

/**
 * Get all unique room names from the scrape_log (includes rooms with no events)
 */
export function getAllScrapedRooms(): Array<{ roomName: string; buildingCode: string }> {
    const db = getDatabase();
    if (!db) {
        throw new Error("Database not available. Run overnight scrape first.");
    }

    try {
        const rows = db.prepare(`
            SELECT room_name, building_code FROM scrape_log
            WHERE status = 'success'
            ORDER BY room_name
        `).all() as { room_name: string; building_code: string }[];

        return rows.map((r) => ({ roomName: r.room_name, buildingCode: r.building_code }));
    } finally {
        db.close();
    }
}

/**
 * Get all lecturers and their timetables from the database
 */
export function getAllLecturers(): Array<{ name: string; timetable: TimetableEntry[] }> {
    const db = getDatabase();
    if (!db) {
        throw new Error("Database not available. Run overnight scrape first.");
    }

    try {
        // Get all lecturers with their events via the join table
        const rows = db.prepare(`
            SELECT l.name as lecturer_name, e.*
            FROM lecturers l
            JOIN event_lecturers el ON l.id = el.lecturer_id
            JOIN events e ON e.id = el.event_id
            ORDER BY l.name, e.start_time ASC
        `).all() as (DbEventRow & { lecturer_name: string })[];

        // Group by lecturer
        const lecturerMap = new Map<string, TimetableEntry[]>();

        for (const row of rows) {
            const entry = dbRowToTimetableEntry(row);
            // Override lecturer with the normalized name from lecturers table
            entry.lecturer = row.lecturer_name;

            const existing = lecturerMap.get(row.lecturer_name);
            if (existing) {
                existing.push(entry);
            } else {
                lecturerMap.set(row.lecturer_name, [entry]);
            }
        }

        return Array.from(lecturerMap.entries()).map(([name, timetable]) => ({
            name,
            timetable,
        }));
    } finally {
        db.close();
    }
}

/**
 * Get timetable for a specific lecturer by name (case-insensitive)
 */
export function getLecturerTimetable(lecturerName: string): TimetableEntry[] | null {
    const db = getDatabase();
    if (!db) {
        throw new Error("Database not available. Run overnight scrape first.");
    }

    try {
        const nameLower = lecturerName.toLowerCase();

        // First find the lecturer
        const lecturer = db.prepare(`
            SELECT id, name FROM lecturers WHERE name_lower = ?
        `).get(nameLower) as { id: number; name: string } | undefined;

        if (!lecturer) {
            return null;
        }

        // Get their events
        const rows = db.prepare(`
            SELECT e.*
            FROM events e
            JOIN event_lecturers el ON e.id = el.event_id
            WHERE el.lecturer_id = ?
            ORDER BY e.start_time ASC
        `).all(lecturer.id) as DbEventRow[];

        return rows.map((row) => {
            const entry = dbRowToTimetableEntry(row);
            entry.lecturer = lecturer.name;
            return entry;
        });
    } finally {
        db.close();
    }
}

/**
 * Get all unique lecturer names from the database
 */
export function getAllLecturerNames(): string[] {
    const db = getDatabase();
    if (!db) {
        throw new Error("Database not available. Run overnight scrape first.");
    }

    try {
        const rows = db.prepare(`
            SELECT name FROM lecturers ORDER BY name ASC
        `).all() as { name: string }[];

        return rows.map((r) => r.name);
    } finally {
        db.close();
    }
}

/**
 * Get scrape metadata (when was the database last updated)
 */
export function getScrapeMetadata(): Record<string, string> {
    const db = getDatabase();
    if (!db) {
        throw new Error("Database not available. Run overnight scrape first.");
    }

    try {
        const rows = db.prepare(`SELECT key, value FROM scrape_metadata`).all() as {
            key: string;
            value: string;
        }[];

        const result: Record<string, string> = {};
        for (const row of rows) {
            result[row.key] = row.value;
        }
        return result;
    } finally {
        db.close();
    }
}

/**
 * Check if the database exists and has data
 */
export function isDatabaseReady(): boolean {
    const db = getDatabase();
    if (!db) {
        return false;
    }

    try {
        const count = db.prepare(`SELECT COUNT(*) as count FROM events`).get() as {
            count: number;
        };
        return count.count > 0;
    } catch {
        return false;
    } finally {
        db.close();
    }
}

import Database from "better-sqlite3";
import { existsSync, mkdirSync, renameSync } from "fs";
import { format } from "date-fns";
import path from "path";

// Use process.cwd() for consistent path resolution regardless of compiled/source execution
const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "events.db");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Rotate the existing events.db to events_YYYY_MM_DD.db
 * Call this before starting a fresh scrape
 */
export function rotateDatabase(): void {
    if (existsSync(DB_PATH)) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = format(yesterday, "yyyy_MM_dd");
        const archivePath = path.join(DATA_DIR, `events_${dateStr}.db`);

        // Don't overwrite existing archives
        if (!existsSync(archivePath)) {
            renameSync(DB_PATH, archivePath);
            console.log(`Rotated old database to ${archivePath}`);
        } else {
            console.log(`Archive ${archivePath} already exists, removing old events.db`);
            // Remove the old file if archive already exists
            require("fs").unlinkSync(DB_PATH);
        }
    }
}

/**
 * Initialize a fresh database with schema
 */
export function initializeDatabase(): Database.Database {
    const db = new Database(DB_PATH);

    // Enable WAL mode for better concurrent access
    db.pragma("journal_mode = WAL");

    // Create tables
    db.exec(`
        -- Main events table (one row per timetable slot)
        CREATE TABLE IF NOT EXISTS events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            room_name       TEXT NOT NULL,
            building_code   TEXT NOT NULL,
            day             TEXT NOT NULL,
            start_time      TEXT NOT NULL,
            end_time        TEXT NOT NULL,
            time_display    TEXT,
            module_code     TEXT,
            module_name     TEXT,
            module_raw      TEXT,
            lecturer_raw    TEXT,
            group_type      TEXT,
            session_type    TEXT,
            slot_index      INTEGER,
            row_index       INTEGER,
            scraped_at      TEXT NOT NULL,
            UNIQUE(room_name, start_time, end_time, module_raw)
        );

        -- Scrape progress tracking (for retry logic)
        CREATE TABLE IF NOT EXISTS scrape_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            room_name       TEXT NOT NULL UNIQUE,
            building_code   TEXT NOT NULL,
            room_url        TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending',
            attempts        INTEGER DEFAULT 0,
            last_attempt    TEXT,
            error_message   TEXT,
            events_found    INTEGER DEFAULT 0
        );

        -- Normalized lecturers for search
        CREATE TABLE IF NOT EXISTS lecturers (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT UNIQUE NOT NULL,
            name_lower      TEXT NOT NULL
        );

        -- Many-to-many: events <-> lecturers
        CREATE TABLE IF NOT EXISTS event_lecturers (
            event_id        INTEGER REFERENCES events(id) ON DELETE CASCADE,
            lecturer_id     INTEGER REFERENCES lecturers(id) ON DELETE CASCADE,
            PRIMARY KEY(event_id, lecturer_id)
        );

        -- Metadata table for tracking scrape info
        CREATE TABLE IF NOT EXISTS scrape_metadata (
            key             TEXT PRIMARY KEY,
            value           TEXT NOT NULL
        );

        -- Indexes for fast lookups
        CREATE INDEX IF NOT EXISTS idx_events_room ON events(room_name);
        CREATE INDEX IF NOT EXISTS idx_events_building ON events(building_code);
        CREATE INDEX IF NOT EXISTS idx_events_module_code ON events(module_code);
        CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_time);
        CREATE INDEX IF NOT EXISTS idx_lecturers_lower ON lecturers(name_lower);
        CREATE INDEX IF NOT EXISTS idx_scrape_log_status ON scrape_log(status);

        -- Courses table
        CREATE TABLE IF NOT EXISTS courses (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            url             TEXT UNIQUE NOT NULL,
            type            TEXT NOT NULL CHECK(type IN ('undergrad', 'postgrad')),
            title           TEXT NOT NULL
        );

        -- Course years
        CREATE TABLE IF NOT EXISTS course_years (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            label           TEXT NOT NULL,
            year_order      INTEGER NOT NULL
        );

        -- Course modules (links courses to modules)
        CREATE TABLE IF NOT EXISTS course_modules (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            course_year_id  INTEGER NOT NULL REFERENCES course_years(id) ON DELETE CASCADE,
            module_code     TEXT NOT NULL,
            module_name     TEXT NOT NULL,
            description     TEXT,
            section_type    TEXT NOT NULL CHECK(section_type IN ('compulsory', 'optional', 'other'))
        );

        -- Indexes for course lookups
        CREATE INDEX IF NOT EXISTS idx_course_modules_code ON course_modules(module_code);
        CREATE INDEX IF NOT EXISTS idx_course_years_course ON course_years(course_id);
        CREATE INDEX IF NOT EXISTS idx_courses_type ON courses(type);
    `);

    return db;
}

/**
 * Get an existing database connection (for API routes)
 */
export function getDatabase(): Database.Database | null {
    if (!existsSync(DB_PATH)) {
        return null;
    }
    const db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");
    return db;
}

/**
 * Parse module string into code and name
 * e.g., "EL4011 - Artificial Intelligence" -> { code: "EL4011", name: "Artificial Intelligence" }
 */
export function parseModule(moduleRaw: string): { code: string | null; name: string | null } {
    if (!moduleRaw) {
        return { code: null, name: null };
    }

    // Pattern: CODE - Name or CODE: Name
    const match = moduleRaw.match(/^([A-Z]{2,4}\d{3,5}[A-Z]?)\s*[-:]\s*(.+)$/i);

    if (match) {
        return {
            code: match[1].toUpperCase(),
            name: match[2].trim(),
        };
    }

    // No code found, treat whole string as name
    return { code: null, name: moduleRaw.trim() };
}

export { DB_PATH, DATA_DIR };

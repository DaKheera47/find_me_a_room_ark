/**
 * Core Scrape Logic
 *
 * Shared scraping functionality used by both overnight-scrape (CLI) and force-scrape (API).
 * This module handles the actual scraping, database insertion, and progress tracking.
 */

import "dotenv/config"; // Load environment variables
import { rotateDatabase, initializeDatabase, parseModule } from "./db";
import { readRoomsFromCSV, scrapeRoomTimeTable } from "../scraping";
import { extractLecturerNames } from "./lecturer-utils";

const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ScrapeStats {
    total: number;
    success: number;
    failed: number;
    eventsInserted: number;
    lecturersFound: number;
}

export interface ScrapeOptions {
    /** Delay in milliseconds between requests. Default: 3000 (3 seconds) */
    delayMs?: number;
    /** Callback for progress updates */
    onProgress?: (stats: ScrapeStats) => void;
}

/**
 * Run a full scrape of all room timetables
 *
 * @param options - Scrape configuration options
 * @returns Final scrape statistics
 */
export async function runScrape(options: ScrapeOptions = {}): Promise<ScrapeStats> {
    const { delayMs = 3000, onProgress } = options;

    console.log("=".repeat(60));
    console.log(`Starting scrape at ${new Date().toISOString()}`);
    console.log(`Delay between requests: ${delayMs}ms`);
    console.log("=".repeat(60));

    // Step 1: Rotate old database
    console.log("\n[1/5] Rotating old database...");
    rotateDatabase();

    // Step 2: Initialize fresh database
    console.log("[2/5] Initializing fresh database...");
    const db = initializeDatabase();

    // Step 3: Load rooms from CSV
    console.log("[3/5] Loading rooms from CSV...");
    const rooms: Room[] = [];
    await readRoomsFromCSV(rooms, "./out/rooms_grouped.csv");
    console.log(`Found ${rooms.length} rooms to scrape`);

    // Step 4: Populate scrape_log with all rooms
    console.log("[4/5] Populating scrape log...");
    const insertScrapeLog = db.prepare(`
        INSERT OR IGNORE INTO scrape_log (room_name, building_code, room_url, status)
        VALUES (?, ?, ?, 'pending')
    `);

    const insertMany = db.transaction((rooms: Room[]) => {
        for (const room of rooms) {
            insertScrapeLog.run(room.name, room.buildingCode, room.url);
        }
    });
    insertMany(rooms);

    // Set scrape start time
    db.prepare(
        `INSERT OR REPLACE INTO scrape_metadata (key, value) VALUES ('scrape_started', ?)`
    ).run(new Date().toISOString());

    // Step 5: Scrape rooms sequentially
    console.log("[5/5] Starting scrape...\n");

    const stats: ScrapeStats = {
        total: rooms.length,
        success: 0,
        failed: 0,
        eventsInserted: 0,
        lecturersFound: 0,
    };

    // Prepare statements
    const getPendingRooms = db.prepare(`
        SELECT room_name, building_code, room_url, attempts
        FROM scrape_log
        WHERE status IN ('pending', 'failed') AND attempts < ?
        ORDER BY attempts ASC, id ASC
    `);

    const updateScrapeLog = db.prepare(`
        UPDATE scrape_log
        SET status = ?, attempts = attempts + 1, last_attempt = ?, error_message = ?, events_found = ?
        WHERE room_name = ?
    `);

    const insertEvent = db.prepare(`
        INSERT OR IGNORE INTO events (
            room_name, building_code, day, start_time, end_time, time_display,
            module_code, module_name, module_raw, lecturer_raw, group_type, session_type,
            slot_index, row_index, scraped_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertLecturer = db.prepare(`
        INSERT OR IGNORE INTO lecturers (name, name_lower) VALUES (?, ?)
    `);

    const getLecturerId = db.prepare(`
        SELECT id FROM lecturers WHERE name_lower = ?
    `);

    const insertEventLecturer = db.prepare(`
        INSERT OR IGNORE INTO event_lecturers (event_id, lecturer_id) VALUES (?, ?)
    `);

    const lecturerSet = new Set<string>();

    // Main scrape loop
    let pendingRooms = getPendingRooms.all(MAX_ATTEMPTS) as Array<{
        room_name: string;
        building_code: string;
        room_url: string;
        attempts: number;
    }>;

    while (pendingRooms.length > 0) {
        for (let i = 0; i < pendingRooms.length; i++) {
            const room = pendingRooms[i];
            const progress = `[${stats.success + stats.failed + 1}/${stats.total}]`;

            process.stdout.write(
                `${progress} Scraping ${room.room_name} (attempt ${room.attempts + 1})... `
            );

            try {
                const entries = await scrapeRoomTimeTable(room.room_url, room.room_name);
                const now = new Date().toISOString();

                // Insert events in a transaction
                const insertEvents = db.transaction((entries: TimetableEntry[]) => {
                    for (const entry of entries) {
                        const { code: moduleCode, name: moduleName } = parseModule(entry.module);

                        const result = insertEvent.run(
                            entry.roomName,
                            room.building_code,
                            entry.day,
                            entry.startDateString,
                            entry.endDateString,
                            entry.time,
                            moduleCode,
                            moduleName,
                            entry.module,
                            entry.lecturer,
                            entry.group,
                            entry.sessionType,
                            entry.slotInDay,
                            entry.topIdx,
                            now
                        );

                        const eventId = result.lastInsertRowid;

                        // Extract and link lecturers
                        if (entry.lecturer && eventId) {
                            const names = extractLecturerNames(entry.lecturer);
                            for (const name of names) {
                                const nameLower = name.toLowerCase();

                                // Insert lecturer if not exists
                                insertLecturer.run(name, nameLower);
                                lecturerSet.add(nameLower);

                                // Get lecturer ID and link
                                const lecturerRow = getLecturerId.get(nameLower) as
                                    | { id: number }
                                    | undefined;
                                if (lecturerRow) {
                                    insertEventLecturer.run(eventId, lecturerRow.id);
                                }
                            }
                        }
                    }
                });

                insertEvents(entries);

                // Update scrape log
                updateScrapeLog.run("success", now, null, entries.length, room.room_name);
                stats.success++;
                stats.eventsInserted += entries.length;

                // Notify progress callback
                if (onProgress) {
                    onProgress({ ...stats, lecturersFound: lecturerSet.size });
                }

                console.log(`✓ ${entries.length} events`);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                updateScrapeLog.run(
                    room.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending",
                    new Date().toISOString(),
                    errorMsg,
                    0,
                    room.room_name
                );

                if (room.attempts + 1 >= MAX_ATTEMPTS) {
                    stats.failed++;
                    console.log(`✗ Failed (${errorMsg})`);
                } else {
                    console.log(`⟳ Retry later (${errorMsg})`);
                }
            }

            // Delay between requests
            if (i < pendingRooms.length - 1) {
                await sleep(delayMs);
            }
        }

        // Check for any remaining retries
        pendingRooms = getPendingRooms.all(MAX_ATTEMPTS) as Array<{
            room_name: string;
            building_code: string;
            room_url: string;
            attempts: number;
        }>;

        if (pendingRooms.length > 0) {
            console.log(`\nRetrying ${pendingRooms.length} failed rooms...\n`);
            await sleep(delayMs * 2); // Extra delay before retries
        }
    }

    // Update metadata
    stats.lecturersFound = lecturerSet.size;
    db.prepare(
        `INSERT OR REPLACE INTO scrape_metadata (key, value) VALUES ('scrape_completed', ?)`
    ).run(new Date().toISOString());
    db.prepare(
        `INSERT OR REPLACE INTO scrape_metadata (key, value) VALUES ('total_events', ?)`
    ).run(String(stats.eventsInserted));
    db.prepare(
        `INSERT OR REPLACE INTO scrape_metadata (key, value) VALUES ('total_lecturers', ?)`
    ).run(String(stats.lecturersFound));
    db.prepare(
        `INSERT OR REPLACE INTO scrape_metadata (key, value) VALUES ('rooms_success', ?)`
    ).run(String(stats.success));
    db.prepare(
        `INSERT OR REPLACE INTO scrape_metadata (key, value) VALUES ('rooms_failed', ?)`
    ).run(String(stats.failed));

    // Close database
    db.close();

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("Scrape Complete!");
    console.log("=".repeat(60));
    console.log(`Rooms scraped:     ${stats.success}/${stats.total}`);
    console.log(`Rooms failed:      ${stats.failed}`);
    console.log(`Events inserted:   ${stats.eventsInserted}`);
    console.log(`Lecturers found:   ${stats.lecturersFound}`);
    console.log(`Finished at:       ${new Date().toISOString()}`);
    console.log("=".repeat(60));

    return stats;
}

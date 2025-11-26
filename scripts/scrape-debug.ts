/**
 * Debug Scraper - Saves raw HTML and parsed data for analysis
 *
 * Run: pnpm tsx scripts/scrape-debug.ts
 *
 * This will:
 * 1. Scrape first 10 CM building rooms
 * 2. Save raw HTML to data/debug/html/
 * 3. Save parsed data to data/debug/parsed/
 * 4. Create a SQLite DB at data/debug/debug.db for analysis
 */

import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import Database from "better-sqlite3";
import { readRoomsFromCSV, scrapeRoomTimeTable } from "../scraping";

// Configuration
const MAX_ROOMS = parseInt(process.env.DEBUG_MAX_ROOMS || "10", 10);
const DELAY_MS = parseInt(process.env.SCRAPE_DELAY_MS || "1000", 10);
const TARGET_BUILDING = "CM"; // Focus on CM building

// Paths
const DEBUG_DIR = path.join(__dirname, "..", "data", "debug");
const HTML_DIR = path.join(DEBUG_DIR, "html");
const PARSED_DIR = path.join(DEBUG_DIR, "parsed");
const DB_PATH = path.join(DEBUG_DIR, "debug.db");
const ROOMS_CSV = path.join(__dirname, "..", "out", "rooms_grouped.csv");

// Ensure directories exist
[DEBUG_DIR, HTML_DIR, PARSED_DIR].forEach((dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function initDebugDb(): Database.Database {
  // Remove old DB
  if (existsSync(DB_PATH)) {
    require("fs").unlinkSync(DB_PATH);
  }

  const db = new Database(DB_PATH);

  db.exec(`
        CREATE TABLE events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_name TEXT NOT NULL,
            building_code TEXT,
            day TEXT NOT NULL,
            start_time TEXT,
            end_time TEXT,
            time_display TEXT,
            module TEXT,
            lecturer TEXT,
            group_type TEXT,
            slot_index INTEGER,
            row_index INTEGER
        );
        
        CREATE TABLE raw_html (
            room_name TEXT PRIMARY KEY,
            html TEXT NOT NULL
        );
        
        CREATE INDEX idx_events_room ON events(room_name);
        CREATE INDEX idx_events_module ON events(module);
        CREATE INDEX idx_events_lecturer ON events(lecturer);
    `);

  return db;
}

async function fetchRoomHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  return response.text();
}

async function main() {
  console.log("=".repeat(60));
  console.log("Debug Scraper - Using existing scrapeRoomTimeTable()");
  console.log("=".repeat(60));

  // Load rooms using existing function
  const allRooms: Room[] = [];
  await readRoomsFromCSV(allRooms, ROOMS_CSV);

  // Filter to CM building and take first N
  const cmRooms = allRooms.filter((r) => r.buildingCode === TARGET_BUILDING);
  const rooms = cmRooms.slice(0, MAX_ROOMS);

  console.log(`\nScraping first ${rooms.length} ${TARGET_BUILDING} rooms (of ${cmRooms.length} in ${TARGET_BUILDING}, ${allRooms.length} total)`);
  console.log(`Rooms: ${rooms.map((r) => r.name).join(", ")}`);
  console.log(`Output: ${DEBUG_DIR}\n`);

  // Init DB
  const db = initDebugDb();

  const insertEvent = db.prepare(`
        INSERT INTO events (
            room_name, building_code, day, start_time, end_time, time_display,
            module, lecturer, group_type, slot_index, row_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

  const insertHtml = db.prepare(`
        INSERT INTO raw_html (room_name, html) VALUES (?, ?)
    `);

  let totalEvents = 0;

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const safeName = room.name.replace(/[^a-zA-Z0-9]/g, "_");

    process.stdout.write(
      `[${i + 1}/${rooms.length}] ${room.name} (${room.url})... `
    );

    try {
      // Fetch raw HTML for debugging
      const html = await fetchRoomHtml(room.url);
      writeFileSync(path.join(HTML_DIR, `${safeName}.html`), html);
      insertHtml.run(room.name, html);

      // Use the EXISTING scraper function - this is what we're testing!
      const entries = await scrapeRoomTimeTable(room.url, room.name);

      // Save parsed JSON
      writeFileSync(
        path.join(PARSED_DIR, `${safeName}.json`),
        JSON.stringify(entries, null, 2)
      );

      // Insert into DB
      const insertMany = db.transaction((eventList: any[]) => {
        for (const entry of eventList) {
          insertEvent.run(
            entry.roomName,
            room.buildingCode,
            entry.day,
            entry.startDateString,
            entry.endDateString,
            entry.time,
            entry.module,
            entry.lecturer,
            entry.group,
            entry.slotInDay,
            entry.topIdx
          );
        }
      });
      insertMany(entries);

      totalEvents += entries.length;
      console.log(`✓ ${entries.length} events`);
    } catch (error) {
      console.log(`✗ ${error}`);
    }

    if (i < rooms.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  db.close();

  console.log("\n" + "=".repeat(60));
  console.log("Done!");
  console.log("=".repeat(60));
  console.log(`Total events: ${totalEvents}`);
  console.log(`\nFiles created:`);
  console.log(`  HTML:   ${HTML_DIR}/`);
  console.log(`  JSON:   ${PARSED_DIR}/`);
  console.log(`  SQLite: ${DB_PATH}`);
  console.log(`\nUseful SQL queries:`);
  console.log(`  -- Find entries where module looks like a lecturer name:`);
  console.log(
    `  SELECT * FROM events WHERE module LIKE '%,%' AND module NOT LIKE '%-%';`
  );
  console.log(`\n  -- Find entries where lecturer looks like a module code:`);
  console.log(`  SELECT * FROM events WHERE lecturer GLOB '[A-Z][A-Z]*[0-9]*';`);
  console.log(`\n  -- See all data for a room:`);
  console.log(`  SELECT * FROM events WHERE room_name = 'CM027';`);
  console.log("=".repeat(60));
}

main().catch(console.error);

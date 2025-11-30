/**
 * Overnight Scrape Script
 *
 * Slowly scrapes all room timetables and stores them in SQLite.
 * Run via: npm run scrape
 *
 * Uses a 3 second delay between requests to avoid rate limiting
 * on the authenticated endpoint.
 */

import { runScrape } from "./scrape-core";

const DELAY_MS = 3000; // 3 seconds between requests (slow scrape for authenticated endpoint)

runScrape({ delayMs: DELAY_MS }).catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});

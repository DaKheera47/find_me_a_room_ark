import { Router } from "express";
import { runScrape, ScrapeStats } from "../scripts/scrape-core";

const forceScrapeRouter = Router();

const DELAY_MS = 100; // Fast scrape for forced/API triggered scrapes

let isScraping = false;
let lastScrapeStatus: {
    status: "idle" | "running" | "completed" | "failed";
    startedAt: string | null;
    completedAt: string | null;
    stats: ScrapeStats | null;
    error: string | null;
} = {
    status: "idle",
    startedAt: null,
    completedAt: null,
    stats: null,
    error: null,
};

/**
 * POST /force-scrape
 * Triggers a full scrape of all room timetables
 */
forceScrapeRouter.post("/force-scrape", async (req, res) => {
    if (isScraping) {
        return res.status(409).json({
            error: "Scrape already in progress",
            status: lastScrapeStatus,
        });
    }

    isScraping = true;
    lastScrapeStatus = {
        status: "running",
        startedAt: new Date().toISOString(),
        completedAt: null,
        stats: null,
        error: null,
    };

    // Start scrape in background and respond immediately
    runScrape({
        delayMs: DELAY_MS,
        onProgress: (stats) => {
            lastScrapeStatus.stats = stats;
        },
    })
        .then((stats) => {
            lastScrapeStatus.status = "completed";
            lastScrapeStatus.completedAt = new Date().toISOString();
            lastScrapeStatus.stats = stats;
        })
        .catch((error) => {
            console.error("Scrape failed:", error);
            lastScrapeStatus.status = "failed";
            lastScrapeStatus.completedAt = new Date().toISOString();
            lastScrapeStatus.error = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
            isScraping = false;
        });

    res.status(202).json({
        message: "Scrape started",
        status: lastScrapeStatus,
    });
});

/**
 * GET /scrape-status
 * Returns the current scrape status
 */
forceScrapeRouter.get("/scrape-status", (req, res) => {
    res.json({
        isScraping,
        ...lastScrapeStatus,
    });
});

/**
 * Trigger a scrape programmatically (used by cron scheduler)
 * Returns a promise that resolves when the scrape completes
 */
export async function triggerScrape(): Promise<void> {
    if (isScraping) {
        console.log("[Cron] Scrape already in progress, skipping scheduled run");
        return;
    }

    isScraping = true;
    lastScrapeStatus = {
        status: "running",
        startedAt: new Date().toISOString(),
        completedAt: null,
        stats: null,
        error: null,
    };

    try {
        const stats = await runScrape({
            delayMs: DELAY_MS,
            onProgress: (stats) => {
                lastScrapeStatus.stats = stats;
            },
        });
        lastScrapeStatus.status = "completed";
        lastScrapeStatus.completedAt = new Date().toISOString();
        lastScrapeStatus.stats = stats;
    } catch (error) {
        console.error("Scrape failed:", error);
        lastScrapeStatus.status = "failed";
        lastScrapeStatus.completedAt = new Date().toISOString();
        lastScrapeStatus.error = error instanceof Error ? error.message : String(error);
        throw error;
    } finally {
        isScraping = false;
    }
}

export { isScraping, lastScrapeStatus };
export default forceScrapeRouter;

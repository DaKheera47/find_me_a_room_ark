import cors from "cors";
import cron from "node-cron";
import express from "express";
import isRoomFreeRouter from "./routes/is-room-free";
import scrapeRoomRouter from "./routes/get-room-timetable";
import getAllRoomInfoRouter from "./routes/get-all-room-info";
import getAvailableRoomsInBuildingRouter from "./routes/get-available-rooms-in-building";
import healthRouter from "./routes/health";
import findRoomsByDurationRouter from "./routes/find-rooms-by-duration";
import lecturersRouter from "./routes/lecturers-db";
import modulesRouter from "./routes/modules";
import forceScrapeRouter, { triggerScrape } from "./routes/force-scrape";
import icsRouter from "./routes/ics-timetable";
import coursesRouter from "./routes/courses";

const app = express();
const port = process.env.PORT || 8072;

app.use(cors());
process.setMaxListeners(20); // Or higher, calculate based on max expected parallelism

// Middleware to parse JSON bodies
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Welcome to the Room Timetable API!");
});

// Endpoint to scrape a specific room's timetable
app.use(scrapeRoomRouter);

app.use(isRoomFreeRouter);

app.use(getAllRoomInfoRouter);

app.use(getAvailableRoomsInBuildingRouter);

app.use(healthRouter);

app.use(findRoomsByDurationRouter);

app.use(lecturersRouter);

app.use(modulesRouter);

app.use(forceScrapeRouter);

app.use(icsRouter);

app.use(coursesRouter);

// Schedule daily scrape at 03:00 AM London time
const SCRAPE_CRON_SCHEDULE = process.env.SCRAPE_CRON_SCHEDULE || "0 3 * * *";
const SCRAPE_TIMEZONE = process.env.SCRAPE_TIMEZONE || "Europe/London";

cron.schedule(
    SCRAPE_CRON_SCHEDULE,
    async () => {
        console.log(`[Cron] Scheduled scrape triggered at ${new Date().toISOString()}`);
        try {
            await triggerScrape();
            console.log(`[Cron] Scheduled scrape completed successfully at ${new Date().toISOString()}`);
        } catch (error) {
            console.error(`[Cron] Scheduled scrape failed:`, error);
        }
    },
    {
        timezone: SCRAPE_TIMEZONE,
    }
);

console.log(`[Cron] Scrape scheduled: "${SCRAPE_CRON_SCHEDULE}" (timezone: ${SCRAPE_TIMEZONE})`);

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

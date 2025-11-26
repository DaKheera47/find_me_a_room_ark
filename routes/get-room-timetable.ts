import { Router } from "express";
import { getRoomTimetable, isDatabaseReady } from "../scripts/db-queries";

const scrapeRoomRouter = Router();

scrapeRoomRouter.post("/get-room-timetable", async (req, res) => {
    const { roomName } = req.body as ScrapeRoomRequestBody;

    console.log(
        "REQUEST AT /get-room-timetable",
        req.body,
        roomName,
        new Date().toISOString()
    );

    if (!roomName) {
        return res
            .status(400)
            .send({ error: "Missing roomName in request body." });
    }

    if (!isDatabaseReady()) {
        return res
            .status(503)
            .send({ error: "Database not ready. Run overnight scrape first." });
    }

    try {
        const timetable = getRoomTimetable(roomName);
        res.json(timetable);
    } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to retrieve room timetable." });
    }
});

export default scrapeRoomRouter;

import { Router } from "express";
import { findRoomAvailability } from "../date_time_calc";
import { getRoomTimetable, isDatabaseReady } from "../scripts/db-queries";

const isRoomFreeRouter = Router();

isRoomFreeRouter.post("/is-room-free", async (req, res) => {
    const { roomName } = req.body as ScrapeRoomRequestBody;

    console.log(
        "REQUEST AT /is-room-free",
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
        const dateBeingChecked = new Date();
        const out = findRoomAvailability(timetable, dateBeingChecked);

        res.json({
            roomName: roomName,
            isFree: out,
            dateBeingChecked: dateBeingChecked.toISOString(),
        });
    } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to retrieve room timetable." });
    }
});

export default isRoomFreeRouter;

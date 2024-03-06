import { Router } from "express";
import { findRoomAvailability } from "../date_time_calc";
import { readRoomsFromCSV, scrapeRoomTimeTable } from "../scraping";

const isRoomFreeRouter = Router();

isRoomFreeRouter.post("/is-room-free", async (req, res) => {
    const { roomName } = req.body as ScrapeRoomRequestBody;

    console.log(
        "REQUEST AT /find-free-time",
        req.body,
        roomName,
        new Date().toISOString()
    );

    if (!roomName) {
        return res
            .status(400)
            .send({ error: "Missing roomName in request body." });
    }

    let rooms: Room[] = [];

    // read rooms from csv
    await readRoomsFromCSV(rooms, "./out/rooms_grouped.csv");

    // find the room url from the rooms array
    const room = rooms.find((room) => room.name === roomName);

    if (!room) {
        return res.status(404).send({ error: "Room not found." });
    }

    // get the room url from the rooms array
    try {
        const scrapeResult = await scrapeRoomTimeTable(room?.url, room?.name);

        const testDate = new Date("2024-03-05T10:30:00Z");
        const out = findRoomAvailability(scrapeResult, testDate);

        res.json(out);
    } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to scrape room timetable." });
    }
});

export default isRoomFreeRouter;

import { Router } from "express";
import { readRoomsFromCSV, scrapeRoomTimeTable } from "../scraping";
import { findRoomAvailability } from "../date_time_calc";

const getAllRoomInfoRouter = Router();

getAllRoomInfoRouter.post("/get-all-room-info", async (req, res) => {
    const { roomName } = req.body as ScrapeRoomRequestBody;

    console.log(
        "REQUEST AT /get-all-room-info",
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

        const dateBeingChecked = new Date();
        const out = findRoomAvailability(scrapeResult, dateBeingChecked);

        res.json({
            timetable: scrapeResult,
            roomName: room.name,
            dateBeingChecked: dateBeingChecked.toISOString(),
            isFree: out,
        });
    } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to scrape room timetable." });
    }
});

export default getAllRoomInfoRouter;

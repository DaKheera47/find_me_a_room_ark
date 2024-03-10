import { Router } from "express";
import {
    readBuildingsFromCSV,
    readRoomsFromCSV,
    scrapeRoomTimeTable,
} from "../scraping";
import { findRoomAvailability } from "../date_time_calc";

const getAvailableRoomsInBuildingRouter = Router();

getAvailableRoomsInBuildingRouter.post(
    "/get-available-rooms-in-building",
    async (req, res) => {
        const { buildingCode, floorToFind } = req.body as {
            buildingCode: BuildingCode;
            floorToFind: number;
        };

        console.log(
            "REQUEST AT /get-available-rooms-in-building",
            req.body,
            buildingCode,
            new Date().toISOString()
        );

        if (!buildingCode) {
            return res
                .status(400)
                .send({ error: "Missing buildingCode in request body." });
        }

        if (floorToFind === undefined || floorToFind === null) {
            return res
                .status(400)
                .send({ error: "Missing floorToFind in request body." });
        }

        // read rooms from csv
        const buildings = await readBuildingsFromCSV(
            "./static/preston_buildings.csv"
        );

        // for the building code, get the rooms
        const building = buildings.find(
            (building) => building.code === buildingCode
        );

        if (!building) {
            return res.status(404).send({ error: "Building not found." });
        }

        // read rooms from csv
        let rooms: Room[] = [];
        await readRoomsFromCSV(rooms, "./out/rooms_grouped.csv");

        // filter the rooms
        rooms = rooms.filter((room) => room.buildingCode === buildingCode);

        // filter the rooms by floor
        // remove the building code from the room name
        rooms = rooms.filter((room) => {
            const replaced = room.name.replace(buildingCode, "");
            const roomFloor = parseInt(replaced[0]) ?? 0;
            return roomFloor === floorToFind;
        });

        // Define a type where the keys are room names (string) and values are TimetableEntry arrays
        type RoomWithTimetable = {
            room: Room;
            timetable: TimetableEntry[];
        };

        const combinedData: RoomWithTimetable[] = [];

        // scrape the timetable for each room
        for (let i = 0; i < rooms.length; i++) {
            const room = rooms[i];
            // Assuming scrapeRoomTimeTable is an async function that returns a TimetableEntry array
            const timetable: TimetableEntry[] = await scrapeRoomTimeTable(
                room.url,
                room.name
            );

            // check room is available
            const isRoomAvailable = findRoomAvailability(timetable, new Date());

            if (!isRoomAvailable) {
                continue;
            }

            combinedData.push({
                room: room, // the room object
                timetable: timetable, // the associated timetable object
            });
        }

        return res.status(200).send(combinedData);
    }
);

export default getAvailableRoomsInBuildingRouter;

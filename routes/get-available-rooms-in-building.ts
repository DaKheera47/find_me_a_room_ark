import { Router } from "express";
import {
    readBuildingsFromCSV,
    readRoomsFromCSV,
} from "../scraping";
import { findRoomAvailability } from "../date_time_calc";
import { getMultipleRoomTimetables, isDatabaseReady } from "../scripts/db-queries";

const getAvailableRoomsInBuildingRouter = Router();

// Define the type for the combined data explicitly
type RoomWithTimetable = {
    room: Room;
    timetable: TimetableEntry[];
};

getAvailableRoomsInBuildingRouter.post(
    "/get-available-rooms-in-building",
    async (req, res) => {
        // Add a top-level try-catch for general error handling
        try {
            const requestStartTime = Date.now();
            const { buildingCode, floorToFind } = req.body as {
                buildingCode: BuildingCode;
                floorToFind: number;
            };

            console.log(
                `REQUEST AT /get-available-rooms-in-building - Building: ${buildingCode}, Floor: ${floorToFind}, Time: ${new Date().toISOString()}`
            );

            // --- Input Validation ---
            if (!buildingCode) {
                return res
                    .status(400)
                    .send({ error: "Missing buildingCode in request body." });
            }
            // Ensure floorToFind is a valid number (check for undefined, null, and NaN)
            if (floorToFind === undefined || floorToFind === null || isNaN(floorToFind)) {
                return res
                    .status(400)
                    .send({ error: "Missing or invalid floorToFind in request body. It must be a number." });
            }

            if (!isDatabaseReady()) {
                return res
                    .status(503)
                    .send({ error: "Database not ready. Run overnight scrape first." });
            }

            // --- Read Building Data ---
            const buildings = await readBuildingsFromCSV(
                "./static/preston_buildings.csv"
            );
            const building = buildings.find(
                (b) => b.code === buildingCode
            );
            if (!building) {
                console.log(`Building not found: ${buildingCode}`);
                return res.status(404).send({ error: `Building with code ${buildingCode} not found.` });
            }

            // --- Read and Filter Room Data ---
            let allRooms: Room[] = [];
            await readRoomsFromCSV(allRooms, "./out/rooms_grouped.csv");

            // Filter rooms by building code first
            const roomsInBuilding = allRooms.filter((room) => room.buildingCode === buildingCode);

            // Filter by floor
            const roomsOnFloor = roomsInBuilding.filter((room) => {
                // Robust floor extraction: remove building code, take first char, parse as int
                const roomNameWithoutBuilding = room.name.replace(buildingCode, "");
                // Handle cases like "G" for Ground floor or non-numeric prefixes
                if (!roomNameWithoutBuilding || isNaN(parseInt(roomNameWithoutBuilding[0]))) {
                     // Special case: Check if floorToFind is 0 and the first char is 'G' (for Ground)
                     if (floorToFind === 0 && roomNameWithoutBuilding.toUpperCase().startsWith('G')) {
                        return true;
                     }
                    console.warn(`Could not parse floor number from room name: ${room.name}. Skipping.`);
                    return false;
                }
                const roomFloor = parseInt(roomNameWithoutBuilding[0]);
                return roomFloor === floorToFind;
            });

            if (roomsOnFloor.length === 0) {
                console.log(`No rooms found for building ${buildingCode} on floor ${floorToFind}.`);
                return res.status(200).send([]);
            }

            console.log(`Found ${roomsOnFloor.length} rooms matching criteria. Fetching from database...`);

            // --- Database Query (instant, no scraping!) ---
            const startTime = Date.now();
            const roomNames = roomsOnFloor.map(r => r.name);
            const timetableMap = getMultipleRoomTimetables(roomNames);
            const endTime = Date.now();
            console.log(`Database query time: ${(endTime - startTime)}ms`);

            // --- Process Results and Check Availability ---
            const combinedData: RoomWithTimetable[] = [];
            const now = new Date();

            for (const room of roomsOnFloor) {
                const timetable = timetableMap.get(room.name) || [];
                const isRoomAvailable = findRoomAvailability(timetable, now);

                if (isRoomAvailable) {
                    combinedData.push({
                        room: room,
                        timetable: timetable,
                    });
                }
            }

            console.log(`Found ${combinedData.length} available rooms out of ${roomsOnFloor.length} checked.`);

            // --- Send Response ---
            const requestEndTime = Date.now();
            console.log(`Total request time: ${(requestEndTime - requestStartTime)}ms`);
            return res.status(200).send(combinedData);

        } catch (error) {
            // Catch any unexpected errors during the process
            console.error("Unhandled error in /get-available-rooms-in-building:", error);
            // Send a generic server error response
            return res.status(500).send({ error: "An internal server error occurred." });
        }
    }
);

export default getAvailableRoomsInBuildingRouter;

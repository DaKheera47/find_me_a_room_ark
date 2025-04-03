import { Router } from "express";
import {
    readBuildingsFromCSV,
    readRoomsFromCSV,
    scrapeRoomTimeTable,
    // Assuming TimetableEntry and Room types are exported or defined elsewhere
} from "../scraping";
import { findRoomAvailability } from "../date_time_calc";
// Assuming BuildingCode, Room, TimetableEntry types are defined/imported

const getAvailableRoomsInBuildingRouter = Router();

// Define the type for the combined data explicitly
type RoomWithTimetable = {
    room: Room;
    timetable: TimetableEntry[];
};

getAvailableRoomsInBuildingRouter.post(
    "/get-available-rooms-in-building",
    async (req, res) => {
        console.log("what")
        // Add a top-level try-catch for general error handling
        try {
            console.log("the")
            const requestStartTime = Date.now(); // Start time for the request
            const { buildingCode, floorToFind } = req.body as {
                buildingCode: BuildingCode;
                floorToFind: number;
            };
            console.log("is")

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

            // --- Read Building Data ---
            // Consider making CSV paths configurable or relative to project root
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
            // Assuming readRoomsFromCSV modifies the passed array. If it returns a new array:
            // const allRooms = await readRoomsFromCSV("./out/rooms_grouped.csv");
            await readRoomsFromCSV(allRooms, "./out/rooms_grouped.csv"); // Adjust if needed based on function signature

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
                // It's successful in terms of processing, just no results found.
                return res.status(200).send([]);
            }

            console.log(`Found ${roomsOnFloor.length} rooms matching criteria. Starting parallel scraping...`);

            // --- Parallel Scraping ---
            // Create an array of promises, one for each room scrape
            const scrapePromises = roomsOnFloor.map(room =>
                scrapeRoomTimeTable(room.url, room.name)
                // Optional: Add a .catch here *per promise* if you want to handle
                // individual scrape errors before Promise.allSettled,
                // e.g., return a specific marker like null or an empty array.
                // .catch(err => {
                //     console.error(`Scraping error for ${room.name}: ${err.message}`);
                //     return null; // Indicate failure for this specific room
                // })
            );

            // Wait for all scraping promises to settle (either resolve or reject)
            // start time
            const startTime = Date.now();
            console.log(`Starting scraping at ${new Date(startTime).toISOString()}`);
            const results = await Promise.allSettled(scrapePromises);
            // end time
            const endTime = Date.now();
            console.log(`Scraping finished at ${new Date(endTime).toISOString()}`);
            console.log(`Total scraping time: ${(endTime - startTime) / 1000} seconds`);

            console.log(`Scraping finished. Processing ${results.length} results.`);

            // --- Process Results and Check Availability ---
            const combinedData: RoomWithTimetable[] = [];
            const now = new Date(); // Get the current time once for consistent checks

            results.forEach((result, index) => {
                const room = roomsOnFloor[index]; // Get the corresponding room

                if (result.status === "fulfilled") {
                    // Check if the result value is not null (if using the per-promise .catch above)
                    // if (result.value) {
                    const timetable: TimetableEntry[] = result.value;
                    const isRoomAvailable = findRoomAvailability(timetable, now);

                    if (isRoomAvailable) {
                        combinedData.push({
                            room: room,
                            timetable: timetable,
                        });
                        // console.log(`Room ${room.name} is available.`);
                    } else {
                        // console.log(`Room ${room.name} is busy.`);
                    }
                   // }
                } else {
                    // Log errors for promises that were rejected
                    console.error(`Failed to fetch timetable for room ${room.name} (${room.url}):`, result.reason?.message || result.reason);
                    // Decide if you want to include failed rooms in the response somehow,
                    // maybe with an error flag, or just skip them like here.
                }
            });

            console.log(`Found ${combinedData.length} available rooms out of ${roomsOnFloor.length} checked.`);

            // --- Send Response ---
            // total request time
            const requestEndTime = Date.now();
            console.log(`Total request time: ${(requestEndTime - requestStartTime) / 1000} seconds`);
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

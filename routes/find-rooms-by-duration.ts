import { Router } from "express";
import { isWithinInterval, differenceInMinutes } from "date-fns";
import { readBuildingsFromCSV, readRoomsFromCSV } from "../scraping";
import { getMultipleRoomTimetables, isDatabaseReady } from "../scripts/db-queries";

const findRoomsByDurationRouter = Router();

type RoomAvailability = {
    room: Room;
    availableMinutes: number;
    nextBookingStart?: string;
};

function calculateRoomAvailabilityDuration(
    entries: TimetableEntry[],
    checkDateTime: Date
): number {
    const now = new Date(checkDateTime);

    // Filter entries to only include future bookings from now
    const futureBookings = entries
        .map(entry => ({
            start: new Date(entry.startDateString),
            end: new Date(entry.endDateString),
            entry
        }))
        .filter(booking => booking.start > now)
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    // Check if currently in a booking
    const currentBooking = entries.find(entry => {
        const entryStart = new Date(entry.startDateString);
        const entryEnd = new Date(entry.endDateString);
        return isWithinInterval(now, { start: entryStart, end: entryEnd });
    });

    if (currentBooking) {
        return 0; // Room is currently occupied
    }

    // If no future bookings, assume available until end of day (6 PM)
    if (futureBookings.length === 0) {
        const endOfDay = new Date(now);
        endOfDay.setHours(18, 0, 0, 0); // 6 PM

        if (now < endOfDay) {
            return differenceInMinutes(endOfDay, now);
        } else {
            return 0; // After 6 PM, consider unavailable
        }
    }

    // Calculate time until next booking
    const nextBooking = futureBookings[0];
    return differenceInMinutes(nextBooking.start, now);
}

findRoomsByDurationRouter.post("/find-rooms-by-duration", async (req, res) => {
    try {
        const requestStartTime = Date.now();
        const { buildingCode } = req.body as {
            buildingCode: BuildingCode;
        };

        console.log(
            `REQUEST AT /find-rooms-by-duration - Building: ${buildingCode}, Time: ${new Date().toISOString()}`
        );

        // Input validation
        if (!buildingCode) {
            return res
                .status(400)
                .json({ error: "Missing buildingCode in request body." });
        }

        if (!isDatabaseReady()) {
            return res
                .status(503)
                .json({ error: "Database not ready. Run overnight scrape first." });
        }

        // Read building data
        const buildings = await readBuildingsFromCSV("./static/preston_buildings.csv");
        const building = buildings.find(b => b.code === buildingCode);

        if (!building) {
            console.log(`Building not found: ${buildingCode}`);
            return res.status(404).json({ error: `Building with code ${buildingCode} not found.` });
        }

        // Read room data to get Room objects
        let allRooms: Room[] = [];
        await readRoomsFromCSV(allRooms, "./out/rooms_grouped.csv");

        const roomsInBuilding = allRooms.filter(room => room.buildingCode === buildingCode);

        if (roomsInBuilding.length === 0) {
            console.log(`No rooms found for building ${buildingCode}.`);
            return res.status(200).json([]);
        }

        console.log(`Found ${roomsInBuilding.length} rooms in building. Fetching from database...`);

        // Get timetables from database (instant, no scraping!)
        const startTime = Date.now();
        const roomNames = roomsInBuilding.map(r => r.name);
        const timetableMap = getMultipleRoomTimetables(roomNames);
        const endTime = Date.now();
        console.log(`Database query time: ${(endTime - startTime)}ms`);

        // Process results and calculate availability durations
        const roomAvailabilities: RoomAvailability[] = [];
        const now = new Date();

        for (const room of roomsInBuilding) {
            const timetable = timetableMap.get(room.name) || [];
            const availableMinutes = calculateRoomAvailabilityDuration(timetable, now);

            // Only include rooms available for more than 15 minutes
            if (availableMinutes > 15) {
                // Find next booking for additional context
                const futureBookings = timetable
                    .map(entry => new Date(entry.startDateString))
                    .filter(start => start > now)
                    .sort((a, b) => a.getTime() - b.getTime());

                roomAvailabilities.push({
                    room: room,
                    availableMinutes: availableMinutes,
                    nextBookingStart: futureBookings.length > 0
                        ? futureBookings[0].toISOString()
                        : undefined
                });
            }
        }

        // Sort by available duration (longest first)
        roomAvailabilities.sort((a, b) => b.availableMinutes - a.availableMinutes);

        console.log(`Found ${roomAvailabilities.length} rooms available for >15 minutes out of ${roomsInBuilding.length} checked.`);

        const requestEndTime = Date.now();
        console.log(`Total request time: ${(requestEndTime - requestStartTime)}ms`);

        return res.status(200).json({
            buildingCode,
            timestamp: now.toISOString(),
            availableRooms: roomAvailabilities,
            totalRoomsChecked: roomsInBuilding.length,
            roomsAvailableOverMinDuration: roomAvailabilities.length
        });

    } catch (error) {
        console.error("Unhandled error in /find-rooms-by-duration:", error);
        return res.status(500).json({ error: "An internal server error occurred." });
    }
});

export default findRoomsByDurationRouter;
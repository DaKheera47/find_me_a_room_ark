import { parseISO, getHours, getMinutes, isWithinInterval } from "date-fns";

function normalizeDateTime(checkDateTime: Date, dateTimeString: string): Date {
    const dateTime = parseISO(dateTimeString);
    // Adjust the date of dateTime to match checkDateTime
    const normalizedDateTime = new Date(
        checkDateTime.getFullYear(),
        checkDateTime.getMonth(),
        checkDateTime.getDate(),
        getHours(dateTime),
        getMinutes(dateTime)
    );
    return normalizedDateTime;
}

function findRoomAvailability(
    entries: TimetableEntry[],
    checkDateTime: Date
): boolean {
    // Normalize checkDateTime to disregard seconds and milliseconds
    checkDateTime = new Date(checkDateTime);

    let isAvailableNow = true;

    for (const entry of entries) {
        const entryStart = new Date(entry.startDateString);
        const entryEnd = new Date(entry.endDateString);

        // console.log(
        //     "checkDateTime",
        //     checkDateTime,
        //     "entryStart",
        //     entryStart,
        //     "entryEnd",
        //     entryEnd
        // );

        // Check if checkDateTime is within any booked interval
        if (
            isWithinInterval(checkDateTime, {
                start: entryStart,
                end: entryEnd,
            })
        ) {
            isAvailableNow = false;
            break;
        }
    }

    if (isAvailableNow) {
        console.log("Room is available right now.");
        return true;
    } else {
        console.log("Room is not available right now.");
        return false;
    }
}

export { normalizeDateTime, findRoomAvailability };

import { addDays, startOfToday } from "date-fns";

export type DayAbbreviation =
    | "Mon"
    | "Tue"
    | "Wed"
    | "Thu"
    | "Fri"
    | "Sat"
    | "Sun";

export const getDayFullNameFromAbbreviation = (abbrev: DayAbbreviation) => {
    const dayAbbreviationsToFull = {
        Mon: "Monday",
        Tue: "Tuesday",
        Wed: "Wednesday",
        Thu: "Thursday",
        Fri: "Friday",
        Sat: "Saturday",
        Sun: "Sunday",
    };

    return dayAbbreviationsToFull[abbrev];
};
export function getNextOccurrenceOfDay(dayName: string): Date {
    const daysOfWeek = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];
    const today = startOfToday();
    const todayDayOfWeek = today.getDay();
    const targetDayOfWeek = daysOfWeek.indexOf(dayName);

    if (targetDayOfWeek === -1) {
        throw new Error("Invalid day name");
    }

    let daysToAdd = targetDayOfWeek - todayDayOfWeek;
    if (daysToAdd < 0) {
        // Target day is in the next week
        daysToAdd += 7;
    } else if (daysToAdd === 0) {
        // Today matches the target day; return today's date
        return today;
    }

    return addDays(today, daysToAdd);
}

import { startOfWeek, add, eachDayOfInterval, format, addDays } from "date-fns";

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
    const today = new Date();
    const todayDayOfWeek = today.getDay(); // Sunday = 0, Monday = 1, ..., Saturday = 6
    const targetDayOfWeek = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ].indexOf(dayName);

    if (targetDayOfWeek < 0) {
        throw new Error("Invalid day name");
    }

    // Calculate the difference between today and the next occurrence of the target day
    let daysUntilNextOccurrence = targetDayOfWeek - todayDayOfWeek;
    if (daysUntilNextOccurrence <= 0) {
        // If today is the target day or past it, adjust to next week
        daysUntilNextOccurrence += 7;
    }

    const nextOccurrence = addDays(today, daysUntilNextOccurrence);
    return nextOccurrence;
}

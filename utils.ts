import { startOfWeek, add, eachDayOfInterval, format } from "date-fns";

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
    const start = startOfWeek(today, { weekStartsOn: 1 }); // Adjust weekStartsOn based on your locale if needed
    const end = add(start, { days: 6 });
    const days = eachDayOfInterval({ start, end });
    const nextDay = days.find((d) => format(d, "EEEE") === dayName);
    return nextDay || today; // Fallback to today if not found, adjust as needed
}

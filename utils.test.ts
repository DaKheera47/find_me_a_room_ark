import { describe, it, expect } from "vitest";
import { getDayFullNameFromAbbreviation, getNextOccurrenceOfDay } from "./utils";

describe("utils", () => {
    describe("getDayFullNameFromAbbreviation", () => {
        it("should convert Mon to Monday", () => {
            expect(getDayFullNameFromAbbreviation("Mon")).toBe("Monday");
        });

        it("should convert Tue to Tuesday", () => {
            expect(getDayFullNameFromAbbreviation("Tue")).toBe("Tuesday");
        });

        it("should convert Wed to Wednesday", () => {
            expect(getDayFullNameFromAbbreviation("Wed")).toBe("Wednesday");
        });

        it("should convert Thu to Thursday", () => {
            expect(getDayFullNameFromAbbreviation("Thu")).toBe("Thursday");
        });

        it("should convert Fri to Friday", () => {
            expect(getDayFullNameFromAbbreviation("Fri")).toBe("Friday");
        });

        it("should convert Sat to Saturday", () => {
            expect(getDayFullNameFromAbbreviation("Sat")).toBe("Saturday");
        });

        it("should convert Sun to Sunday", () => {
            expect(getDayFullNameFromAbbreviation("Sun")).toBe("Sunday");
        });
    });

    describe("getNextOccurrenceOfDay", () => {
        it("should return a valid date for Monday", () => {
            const result = getNextOccurrenceOfDay("Monday");
            expect(result).toBeInstanceOf(Date);
            expect(result.getDay()).toBe(1); // Monday is day 1
        });

        it("should return a valid date for Friday", () => {
            const result = getNextOccurrenceOfDay("Friday");
            expect(result).toBeInstanceOf(Date);
            expect(result.getDay()).toBe(5); // Friday is day 5
        });

        it("should return a valid date for Sunday", () => {
            const result = getNextOccurrenceOfDay("Sunday");
            expect(result).toBeInstanceOf(Date);
            expect(result.getDay()).toBe(0); // Sunday is day 0
        });

        it("should throw error for invalid day name", () => {
            expect(() => getNextOccurrenceOfDay("Funday")).toThrow("Invalid day name");
        });

        it("should return a date within the next 7 days", () => {
            const result = getNextOccurrenceOfDay("Wednesday");
            const today = new Date();
            const maxDate = new Date(today);
            maxDate.setDate(today.getDate() + 7);

            expect(result.getTime()).toBeLessThanOrEqual(maxDate.getTime());
        });
    });
});

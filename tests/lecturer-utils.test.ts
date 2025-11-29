import { describe, it, expect } from "vitest";
import {
    extractLecturerNames,
    normaliseLecturerName,
    titleCaseSegment,
    sortByStartDate,
} from "../scripts/lecturer-utils";

describe("lecturer-utils", () => {
    describe("titleCaseSegment", () => {
        it("should title case a lowercase string", () => {
            expect(titleCaseSegment("smith")).toBe("Smith");
        });

        it("should title case after spaces", () => {
            expect(titleCaseSegment("john smith")).toBe("John Smith");
        });

        it("should handle names with apostrophes", () => {
            expect(titleCaseSegment("o'brien")).toBe("O'Brien");
        });
    });

    describe("normaliseLecturerName", () => {
        it("should normalize all-caps name", () => {
            expect(normaliseLecturerName("SMITH, JOHN")).toBe("Smith, John");
        });

        it("should preserve mixed case names", () => {
            expect(normaliseLecturerName("McDonald, Ronald")).toBe("McDonald, Ronald");
        });

        it("should fix spacing around commas", () => {
            expect(normaliseLecturerName("Smith ,  John")).toBe("Smith, John");
        });

        it("should trim whitespace", () => {
            expect(normaliseLecturerName("  Smith, John  ")).toBe("Smith, John");
        });
    });

    describe("extractLecturerNames", () => {
        it("should extract a single lecturer name", () => {
            const names = extractLecturerNames("Smith, John");
            expect(names).toEqual(["Smith, John"]);
        });

        it("should extract multiple lecturers separated by /", () => {
            const names = extractLecturerNames("Smith, John / Doe, Jane");
            expect(names).toContain("Smith, John");
            expect(names).toContain("Doe, Jane");
        });

        it("should extract multiple lecturers separated by &", () => {
            const names = extractLecturerNames("Smith, John & Doe, Jane");
            expect(names).toContain("Smith, John");
            expect(names).toContain("Doe, Jane");
        });

        it("should extract multiple lecturers separated by 'and'", () => {
            const names = extractLecturerNames("Smith, John and Doe, Jane");
            expect(names).toContain("Smith, John");
            expect(names).toContain("Doe, Jane");
        });

        it("should exclude TBC entries", () => {
            const names = extractLecturerNames("TBC");
            expect(names).toHaveLength(0);
        });

        it("should exclude 'vacant' entries", () => {
            const names = extractLecturerNames("Vacant");
            expect(names).toHaveLength(0);
        });

        it("should exclude entries with numbers", () => {
            const names = extractLecturerNames("Room 101");
            expect(names).toHaveLength(0);
        });

        it("should exclude single-word names (no comma or space)", () => {
            const names = extractLecturerNames("Admin");
            expect(names).toHaveLength(0);
        });

        it("should handle empty string", () => {
            const names = extractLecturerNames("");
            expect(names).toHaveLength(0);
        });

        it("should handle null-ish values", () => {
            const names = extractLecturerNames(null as unknown as string);
            expect(names).toHaveLength(0);
        });

        it("should remove content in parentheses", () => {
            const names = extractLecturerNames("Smith, John (PhD)");
            expect(names).toEqual(["Smith, John"]);
        });

        it("should handle 'Lecturer:' prefix", () => {
            const names = extractLecturerNames("Lecturer: Smith, John");
            expect(names).toEqual(["Smith, John"]);
        });
    });

    describe("sortByStartDate", () => {
        it("should sort entries by start date ascending", () => {
            const entries = [
                { startDateString: "2025-11-25T14:00:00" },
                { startDateString: "2025-11-25T09:00:00" },
                { startDateString: "2025-11-25T11:00:00" },
            ];

            const sorted = sortByStartDate(entries);

            expect(sorted[0].startDateString).toBe("2025-11-25T09:00:00");
            expect(sorted[1].startDateString).toBe("2025-11-25T11:00:00");
            expect(sorted[2].startDateString).toBe("2025-11-25T14:00:00");
        });

        it("should not mutate the original array", () => {
            const entries = [
                { startDateString: "2025-11-25T14:00:00" },
                { startDateString: "2025-11-25T09:00:00" },
            ];

            const sorted = sortByStartDate(entries);

            expect(entries[0].startDateString).toBe("2025-11-25T14:00:00");
            expect(sorted).not.toBe(entries);
        });
    });
});

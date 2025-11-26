import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findRoomAvailability, normalizeDateTime } from "./date_time_calc";

describe("date_time_calc", () => {
    describe("normalizeDateTime", () => {
        it("should normalize time to the check date", () => {
            const checkDate = new Date(2025, 10, 25, 10, 30); // Nov 25, 2025, 10:30
            const timeString = "2024-01-01T14:00:00"; // Different date, 14:00

            const result = normalizeDateTime(checkDate, timeString);

            expect(result.getFullYear()).toBe(2025);
            expect(result.getMonth()).toBe(10); // November
            expect(result.getDate()).toBe(25);
            expect(result.getHours()).toBe(14);
            expect(result.getMinutes()).toBe(0);
        });
    });

    describe("findRoomAvailability", () => {
        // Mock console.log to avoid noisy output
        beforeEach(() => {
            vi.spyOn(console, "log").mockImplementation(() => {});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("should return true when no events exist", () => {
            const entries: TimetableEntry[] = [];
            const checkTime = new Date(2025, 10, 25, 10, 0);

            const result = findRoomAvailability(entries, checkTime);

            expect(result).toBe(true);
        });

        it("should return true when check time is outside all events", () => {
            const entries: TimetableEntry[] = [
                {
                    topIdx: 1,
                    slotInDay: 1,
                    time: "09:00 - 10:00",
                    module: "Test Module",
                    lecturer: "Test Lecturer",
                    group: "Test Group",
                    roomName: "CM234",
                    day: "Monday",
                    startDateString: "2025-11-25T09:00:00",
                    endDateString: "2025-11-25T10:00:00",
                },
            ];
            const checkTime = new Date(2025, 10, 25, 11, 0); // 11:00, after the event

            const result = findRoomAvailability(entries, checkTime);

            expect(result).toBe(true);
        });

        it("should return false when check time is within an event", () => {
            const entries: TimetableEntry[] = [
                {
                    topIdx: 1,
                    slotInDay: 1,
                    time: "09:00 - 11:00",
                    module: "Test Module",
                    lecturer: "Test Lecturer",
                    group: "Test Group",
                    roomName: "CM234",
                    day: "Monday",
                    startDateString: "2025-11-25T09:00:00",
                    endDateString: "2025-11-25T11:00:00",
                },
            ];
            const checkTime = new Date(2025, 10, 25, 10, 0); // 10:00, during the event

            const result = findRoomAvailability(entries, checkTime);

            expect(result).toBe(false);
        });

        it("should return false when check time is exactly at event start", () => {
            const entries: TimetableEntry[] = [
                {
                    topIdx: 1,
                    slotInDay: 1,
                    time: "09:00 - 11:00",
                    module: "Test Module",
                    lecturer: "Test Lecturer",
                    group: "Test Group",
                    roomName: "CM234",
                    day: "Monday",
                    startDateString: "2025-11-25T09:00:00",
                    endDateString: "2025-11-25T11:00:00",
                },
            ];
            const checkTime = new Date(2025, 10, 25, 9, 0); // Exactly 09:00

            const result = findRoomAvailability(entries, checkTime);

            expect(result).toBe(false);
        });

        it("should check multiple events and return false if any overlap", () => {
            const entries: TimetableEntry[] = [
                {
                    topIdx: 1,
                    slotInDay: 1,
                    time: "09:00 - 10:00",
                    module: "Morning Module",
                    lecturer: "Lecturer 1",
                    group: "Group 1",
                    roomName: "CM234",
                    day: "Monday",
                    startDateString: "2025-11-25T09:00:00",
                    endDateString: "2025-11-25T10:00:00",
                },
                {
                    topIdx: 2,
                    slotInDay: 2,
                    time: "14:00 - 16:00",
                    module: "Afternoon Module",
                    lecturer: "Lecturer 2",
                    group: "Group 2",
                    roomName: "CM234",
                    day: "Monday",
                    startDateString: "2025-11-25T14:00:00",
                    endDateString: "2025-11-25T16:00:00",
                },
            ];
            const checkTime = new Date(2025, 10, 25, 15, 0); // 15:00, during afternoon event

            const result = findRoomAvailability(entries, checkTime);

            expect(result).toBe(false);
        });

        it("should return true when check time is between events", () => {
            const entries: TimetableEntry[] = [
                {
                    topIdx: 1,
                    slotInDay: 1,
                    time: "09:00 - 10:00",
                    module: "Morning Module",
                    lecturer: "Lecturer 1",
                    group: "Group 1",
                    roomName: "CM234",
                    day: "Monday",
                    startDateString: "2025-11-25T09:00:00",
                    endDateString: "2025-11-25T10:00:00",
                },
                {
                    topIdx: 2,
                    slotInDay: 2,
                    time: "14:00 - 16:00",
                    module: "Afternoon Module",
                    lecturer: "Lecturer 2",
                    group: "Group 2",
                    roomName: "CM234",
                    day: "Monday",
                    startDateString: "2025-11-25T14:00:00",
                    endDateString: "2025-11-25T16:00:00",
                },
            ];
            const checkTime = new Date(2025, 10, 25, 12, 0); // 12:00, between events

            const result = findRoomAvailability(entries, checkTime);

            expect(result).toBe(true);
        });
    });
});

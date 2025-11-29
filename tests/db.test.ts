import { describe, it, expect } from "vitest";
import { parseModule } from "../scripts/db";

describe("db utilities", () => {
    describe("parseModule", () => {
        it("should parse module code and name with dash separator", () => {
            const result = parseModule("EL4011 - Artificial Intelligence");
            expect(result.code).toBe("EL4011");
            expect(result.name).toBe("Artificial Intelligence");
        });

        it("should parse module code and name with colon separator", () => {
            const result = parseModule("CO3808: Web Development");
            expect(result.code).toBe("CO3808");
            expect(result.name).toBe("Web Development");
        });

        it("should handle 2-letter prefix codes", () => {
            const result = parseModule("CO1234 - Introduction to Programming");
            expect(result.code).toBe("CO1234");
            expect(result.name).toBe("Introduction to Programming");
        });

        it("should handle 3-letter prefix codes", () => {
            const result = parseModule("ENG2001 - English Literature");
            expect(result.code).toBe("ENG2001");
            expect(result.name).toBe("English Literature");
        });

        it("should handle 4-letter prefix codes", () => {
            const result = parseModule("COMP1234 - Computer Science");
            expect(result.code).toBe("COMP1234");
            expect(result.name).toBe("Computer Science");
        });

        it("should handle module codes with trailing letter", () => {
            const result = parseModule("EL4011A - Advanced AI");
            expect(result.code).toBe("EL4011A");
            expect(result.name).toBe("Advanced AI");
        });

        it("should return null code for non-standard format", () => {
            const result = parseModule("Some Random Module");
            expect(result.code).toBeNull();
            expect(result.name).toBe("Some Random Module");
        });

        it("should handle empty string", () => {
            const result = parseModule("");
            expect(result.code).toBeNull();
            expect(result.name).toBeNull();
        });

        it("should handle null/undefined", () => {
            const result = parseModule(null as unknown as string);
            expect(result.code).toBeNull();
            expect(result.name).toBeNull();
        });

        it("should uppercase module codes", () => {
            const result = parseModule("el4011 - lowercase code");
            expect(result.code).toBe("EL4011");
        });
    });
});

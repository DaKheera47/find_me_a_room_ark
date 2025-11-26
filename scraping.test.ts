/**
 * Tests for scraping.ts parsing logic
 * 
 * Run: pnpm test scraping.test.ts
 */

import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { format, parse } from "date-fns";

// Re-implement the parsing logic for testing (extracted from scrapeRoomTimeTable)
// This allows us to test the parsing without making HTTP requests

const VALID_EVENT_CLASSNAMES = [
    "scan_open",
    "TimeTableEvent",
    "TimeTableCurrentEvent",
    "TimeTableClash",
];

interface ParsedEvent {
    time: string | null;
    module: string | null;
    lecturer: string | null;
    group: string | null;
}

/**
 * Parse a single event block (array of lines) into structured data
 */
function parseEventBlock(lines: string[]): ParsedEvent {
    let time: string | null = null;
    let module: string | null = null;
    let lecturer: string | null = null;
    let group: string | null = null;

    for (const line of lines) {
        // Time pattern: HH:MM - HH:MM
        if (!time && /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(line)) {
            time = line;
            continue;
        }

        // Module pattern: 2-4 letters + 3-5 digits, optionally followed by letter, then separator and name
        if (!module && /^[A-Z]{2,4}\d{3,5}[A-Z]?\s*[-–:]/i.test(line)) {
            module = line;
            continue;
        }

        // Group patterns: session types
        if (!group && /^(Lecture|Practical|Seminar|Workshop|Tutorial|Lab|Placement|Project|Exam|Assessment|Drop[\s-]?in|Non[\s-]?Teaching)/i.test(line)) {
            group = line;
            continue;
        }
        if (!group && /\((On\s*Campus|Online|Hybrid)\)\s*$/i.test(line)) {
            group = line;
            continue;
        }

        // Lecturer patterns
        if (!lecturer) {
            // Pattern 1: Comma-separated name "LastName, FirstName"
            if (line.includes(',') && 
                /^[A-Za-z'-]+,\s*[A-Za-z'-]+/.test(line) &&
                !/^\d/.test(line) &&
                !/^[A-Z]{2,4}\d{3,5}/i.test(line)) {
                lecturer = line;
                continue;
            }
            // Pattern 2: Username format (e.g., MEEMohamed)
            if (/^[A-Z]+[a-z]+[A-Za-z]*$/.test(line) &&
                !/^(Lecture|Practical|Seminar|Workshop|Tutorial|Lab|Placement|Project|Exam|Assessment|Online|Hybrid)/i.test(line) &&
                line.length >= 4 && line.length <= 30) {
                lecturer = line;
                continue;
            }
        }

        // Fallback: if nothing matched and we don't have module, treat as module
        if (!module) {
            module = line;
        }
    }

    return { time, module, lecturer, group };
}

/**
 * Parse cell text that may contain multiple events (for clash cells)
 */
function parseCellText(columnText: string, isClashCell: boolean): ParsedEvent[] {
    const results: ParsedEvent[] = [];
    
    let eventBlocks: string[][];
    
    if (isClashCell) {
        // Split text into event blocks - each starts with a time pattern
        const allLines = columnText.split("\n").map(s => s.trim()).filter(Boolean);
        eventBlocks = [];
        let currentBlock: string[] = [];
        
        for (const line of allLines) {
            // Skip the "Clashing Events" header line
            if (/clashing events/i.test(line)) continue;
            
            // If this is a time line and we have a current block, save it and start new
            if (/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(line)) {
                if (currentBlock.length > 0) {
                    eventBlocks.push(currentBlock);
                }
                currentBlock = [line];
            } else if (currentBlock.length > 0) {
                currentBlock.push(line);
            }
        }
        // Don't forget the last block
        if (currentBlock.length > 0) {
            eventBlocks.push(currentBlock);
        }
    } else {
        // Single event - just one block
        eventBlocks = [columnText.split("\n").map(s => s.trim()).filter(Boolean)];
    }
    
    for (const block of eventBlocks) {
        if (block.length >= 2) {
            results.push(parseEventBlock(block));
        }
    }
    
    return results;
}

// ============================================================================
// TESTS
// ============================================================================

describe("Time Pattern Matching", () => {
    it("should match standard time format HH:MM - HH:MM", () => {
        const result = parseEventBlock(["09:00 - 10:00", "CO2401 - Software Development"]);
        expect(result.time).toBe("09:00 - 10:00");
    });

    it("should match time with single digit hours", () => {
        const result = parseEventBlock(["9:00 - 10:00", "CO2401 - Software Development"]);
        expect(result.time).toBe("9:00 - 10:00");
    });

    it("should match afternoon times", () => {
        const result = parseEventBlock(["14:00 - 16:00", "CO3722 - Data Science"]);
        expect(result.time).toBe("14:00 - 16:00");
    });

    it("should match evening times", () => {
        const result = parseEventBlock(["18:00 - 20:00", "CO1234 - Evening Class"]);
        expect(result.time).toBe("18:00 - 20:00");
    });
});

describe("Module Code Pattern Matching", () => {
    it("should match standard module code format (CO2401)", () => {
        const result = parseEventBlock(["09:00 - 10:00", "CO2401 - Software Development"]);
        expect(result.module).toBe("CO2401 - Software Development");
    });

    it("should match module codes with different prefixes", () => {
        const cases = [
            "PS1010 - Methods and practice of psychological inquiry",
            "EL2010 - Software Development",
            "BM4046 - Data Analytics Applied",
            "MA2853 - Numerical Methods",
        ];
        
        for (const moduleStr of cases) {
            const result = parseEventBlock(["10:00 - 12:00", moduleStr]);
            expect(result.module).toBe(moduleStr);
        }
    });

    it("should match 6-digit module codes", () => {
        const result = parseEventBlock(["13:00 - 14:00", "120251 - Academic support"]);
        expect(result.module).toBe("120251 - Academic support");
    });

    it("should match module codes with trailing letter", () => {
        const result = parseEventBlock(["10:00 - 11:00", "CO3808A - Advanced Topics"]);
        expect(result.module).toBe("CO3808A - Advanced Topics");
    });
});

describe("Lecturer Pattern Matching", () => {
    it("should match LastName, FirstName format", () => {
        const result = parseEventBlock([
            "09:00 - 10:00",
            "CO2401 - Software Development",
            "King, John",
            "Practical (On Campus)"
        ]);
        expect(result.lecturer).toBe("King, John");
    });

    it("should match lecturer names with hyphens", () => {
        const result = parseEventBlock([
            "10:00 - 12:00",
            "CO2011 - Database Systems",
            "O'Brien-Smith, Mary",
            "Lecture (On Campus)"
        ]);
        expect(result.lecturer).toBe("O'Brien-Smith, Mary");
    });

    it("should match lecturer names with apostrophes", () => {
        const result = parseEventBlock([
            "11:00 - 13:00",
            "PS1010 - Psychology",
            "O'Connor, Patrick",
            "Workshop (On Campus)"
        ]);
        expect(result.lecturer).toBe("O'Connor, Patrick");
    });

    it("should match username format (MEEMohamed)", () => {
        const result = parseEventBlock([
            "13:00 - 14:00",
            "120251 - Academic support",
            "MEEMohamed",
            "Non-Teaching"
        ]);
        expect(result.lecturer).toBe("MEEMohamed");
    });

    it("should match various username formats", () => {
        const usernames = ["JSmith", "ABrown", "MClarke", "RJohnson"];
        
        for (const username of usernames) {
            const result = parseEventBlock([
                "10:00 - 11:00",
                "CO1234 - Test Module",
                username,
                "Practical (On Campus)"
            ]);
            expect(result.lecturer).toBe(username);
        }
    });

    it("should NOT match module codes as lecturer", () => {
        const result = parseEventBlock([
            "09:00 - 10:00",
            "CO2401 - Software Development",
            "Practical (On Campus)"
        ]);
        // Module code should not be mistaken for lecturer
        expect(result.lecturer).toBeNull();
        expect(result.module).toBe("CO2401 - Software Development");
    });

    it("should handle missing lecturer gracefully", () => {
        const result = parseEventBlock([
            "10:00 - 11:00",
            "CO2007 - The Agile Professional",
            "Drop In Session (Optional)"
        ]);
        expect(result.lecturer).toBeNull();
        expect(result.time).toBe("10:00 - 11:00");
        expect(result.module).toBe("CO2007 - The Agile Professional");
        expect(result.group).toBe("Drop In Session (Optional)");
    });
});

describe("Group/Session Type Pattern Matching", () => {
    it("should match Practical (On Campus)", () => {
        const result = parseEventBlock([
            "09:00 - 10:00",
            "CO2401 - Software Development",
            "King, John",
            "Practical (On Campus)"
        ]);
        expect(result.group).toBe("Practical (On Campus)");
    });

    it("should match Lecture (On Campus)", () => {
        const result = parseEventBlock([
            "10:00 - 12:00",
            "MA2853 - Numerical Methods",
            "Powles, Christopher",
            "Lecture (On Campus)"
        ]);
        expect(result.group).toBe("Lecture (On Campus)");
    });

    it("should match Workshop (On Campus)", () => {
        const result = parseEventBlock([
            "09:00 - 11:00",
            "PS1010 - Psychology Methods",
            "Workshop (On Campus)"
        ]);
        expect(result.group).toBe("Workshop (On Campus)");
    });

    it("should match Drop In Session", () => {
        const result = parseEventBlock([
            "10:00 - 11:00",
            "CO2007 - The Agile Professional",
            "Drop In Session (Optional)"
        ]);
        expect(result.group).toBe("Drop In Session (Optional)");
    });

    it("should match Non-Teaching", () => {
        const result = parseEventBlock([
            "13:00 - 14:00",
            "120251 - Academic support",
            "MEEMohamed",
            "Non-Teaching"
        ]);
        expect(result.group).toBe("Non-Teaching");
    });

    it("should match various session types", () => {
        const sessionTypes = [
            "Seminar (On Campus)",
            "Tutorial (Online)",
            "Lab (On Campus)",
            "Assessment",
            "Project",
            "Placement",
        ];
        
        for (const sessionType of sessionTypes) {
            const result = parseEventBlock([
                "10:00 - 12:00",
                "CO1234 - Test Module",
                "Smith, John",
                sessionType
            ]);
            expect(result.group).toBe(sessionType);
        }
    });
});

describe("Clash Cell Parsing", () => {
    it("should parse multiple events from a clash cell", () => {
        const clashText = `Clashing Events - Please Contact your school

10:00 - 13:00
BM4046 - Data Analytics Applied (BLK)
C & T Building - CM017 - PC Lab  (C&T Building)
Lecture (On Campus) (Group: Full_Group)

10:00 - 13:00
BM4040 - Data Power Deci-Making (BLK)
C & T Building - CM017 - PC Lab  (C&T Building)
Dimitriadou, Athanasia
Lecture (On Campus) (Group: Full_Group)`;

        const results = parseCellText(clashText, true);
        
        expect(results.length).toBe(2);
        
        // First event
        expect(results[0].time).toBe("10:00 - 13:00");
        expect(results[0].module).toBe("BM4046 - Data Analytics Applied (BLK)");
        expect(results[0].group).toBe("Lecture (On Campus) (Group: Full_Group)");
        
        // Second event
        expect(results[1].time).toBe("10:00 - 13:00");
        expect(results[1].module).toBe("BM4040 - Data Power Deci-Making (BLK)");
        expect(results[1].lecturer).toBe("Dimitriadou, Athanasia");
        expect(results[1].group).toBe("Lecture (On Campus) (Group: Full_Group)");
    });

    it("should handle clash cell with events at different times", () => {
        const clashText = `Clashing Events - Please Contact your school

09:00 - 11:00
CO1234 - Morning Class
Smith, John
Lecture (On Campus)

14:00 - 16:00
CO5678 - Afternoon Class
Brown, Jane
Practical (On Campus)`;

        const results = parseCellText(clashText, true);
        
        expect(results.length).toBe(2);
        expect(results[0].time).toBe("09:00 - 11:00");
        expect(results[1].time).toBe("14:00 - 16:00");
    });
});

describe("Edge Cases", () => {
    it("should handle event with only time and module (no lecturer, no group)", () => {
        const result = parseEventBlock([
            "09:00 - 10:00",
            "CO2401 - Software Development"
        ]);
        expect(result.time).toBe("09:00 - 10:00");
        expect(result.module).toBe("CO2401 - Software Development");
        expect(result.lecturer).toBeNull();
        expect(result.group).toBeNull();
    });

    it("should handle event with time, module, and group but no lecturer", () => {
        const result = parseEventBlock([
            "10:00 - 11:00",
            "CO2007 - The Agile Professional (Full Yr at Preston)",
            "Drop In Session (Optional)"
        ]);
        expect(result.time).toBe("10:00 - 11:00");
        expect(result.module).toBe("CO2007 - The Agile Professional (Full Yr at Preston)");
        expect(result.lecturer).toBeNull();
        expect(result.group).toBe("Drop In Session (Optional)");
    });

    it("should not confuse session types with lecturer usernames", () => {
        // "Practical" should not be parsed as a username
        const result = parseEventBlock([
            "09:00 - 10:00",
            "CO2401 - Software Development",
            "Practical (On Campus)"
        ]);
        expect(result.lecturer).toBeNull();
        expect(result.group).toBe("Practical (On Campus)");
    });

    it("should handle module with parentheses in name", () => {
        const result = parseEventBlock([
            "09:00 - 10:00",
            "CO2401 - Software Development (Full Yr at Preston)",
            "King, John",
            "Practical (On Campus)"
        ]);
        expect(result.module).toBe("CO2401 - Software Development (Full Yr at Preston)");
    });

    it("should handle multiple lecturers separated by line breaks", () => {
        // In real data, multiple lecturers might appear on separate lines
        // Currently we only capture the first one
        const result = parseEventBlock([
            "09:00 - 10:00",
            "CO2401 - Software Development",
            "King, John",
            "Smith, Jane",
            "Practical (On Campus)"
        ]);
        expect(result.lecturer).toBe("King, John");
    });
});

describe("Full Cell Text Parsing (Non-Clash)", () => {
    it("should parse a standard 4-line event", () => {
        const cellText = `09:00 - 10:00
CO2401 - Software Development (Full Yr at Preston)
King, John
Practical (On Campus)`;

        const results = parseCellText(cellText, false);
        
        expect(results.length).toBe(1);
        expect(results[0].time).toBe("09:00 - 10:00");
        expect(results[0].module).toBe("CO2401 - Software Development (Full Yr at Preston)");
        expect(results[0].lecturer).toBe("King, John");
        expect(results[0].group).toBe("Practical (On Campus)");
    });

    it("should parse a 3-line event without lecturer", () => {
        const cellText = `10:00 - 11:00
CO2007 - The Agile Professional (Full Yr at Preston)
Drop In Session (Optional)`;

        const results = parseCellText(cellText, false);
        
        expect(results.length).toBe(1);
        expect(results[0].time).toBe("10:00 - 11:00");
        expect(results[0].module).toBe("CO2007 - The Agile Professional (Full Yr at Preston)");
        expect(results[0].lecturer).toBeNull();
        expect(results[0].group).toBe("Drop In Session (Optional)");
    });
});

describe("Real-World Examples from CM017", () => {
    it("should parse Wednesday 09:00 - 10:00 event", () => {
        const cellText = `09:00 - 10:00
CO2401 - Software Development (Full Yr at Preston)
King, John
Practical (On Campus)`;

        const results = parseCellText(cellText, false);
        expect(results[0]).toEqual({
            time: "09:00 - 10:00",
            module: "CO2401 - Software Development (Full Yr at Preston)",
            lecturer: "King, John",
            group: "Practical (On Campus)"
        });
    });

    it("should parse Friday Drop-In session without lecturer", () => {
        const cellText = `10:00 - 11:00
CO2007 - The Agile Professional (Full Yr at Preston)
Drop In Session (Optional)`;

        const results = parseCellText(cellText, false);
        expect(results[0]).toEqual({
            time: "10:00 - 11:00",
            module: "CO2007 - The Agile Professional (Full Yr at Preston)",
            lecturer: null,
            group: "Drop In Session (Optional)"
        });
    });

    it("should parse Friday Drop-In session with lecturer", () => {
        const cellText = `11:00 - 13:00
CO2007 - The Agile Professional (Full Yr at Preston)
Hrycak, John
Drop In Session (Optional)`;

        const results = parseCellText(cellText, false);
        expect(results[0]).toEqual({
            time: "11:00 - 13:00",
            module: "CO2007 - The Agile Professional (Full Yr at Preston)",
            lecturer: "Hrycak, John",
            group: "Drop In Session (Optional)"
        });
    });
});

describe("Real-World Examples from CM019", () => {
    it("should parse event with username lecturer (MEEMohamed)", () => {
        const cellText = `13:00 - 14:00
120251 - Academic support
MEEMohamed
Non-Teaching`;

        const results = parseCellText(cellText, false);
        expect(results[0]).toEqual({
            time: "13:00 - 14:00",
            module: "120251 - Academic support",
            lecturer: "MEEMohamed",
            group: "Non-Teaching"
        });
    });
});

import { parse as parseCSV } from "csv-parse";
import { format, parse } from "date-fns";
import { createReadStream } from "fs";
import * as cheerio from 'cheerio';
import {
    DayAbbreviation,
    getDayFullNameFromAbbreviation,
    getNextOccurrenceOfDay,
} from "./utils";

// SpanWeek URL format (requires auth, but has group info)
const SPANWEEK_BASE_URL = "https://apps.uclan.ac.uk/TimeTables/SpanWeek/WkMatrixNow";

// Build auth header from environment variables
function getAuthHeader(): string | null {
    const username = process.env.UCLAN_USERNAME;
    const password = process.env.UCLAN_PASSWORD;
    
    if (!username || !password) {
        console.warn("UCLAN_USERNAME or UCLAN_PASSWORD not set - scraping will likely fail with 401");
        return null;
    }
    
    return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

// Convert old MvCRoomTimetable URL to SpanWeek URL
function convertToSpanWeekUrl(oldUrl: string, roomName: string): string {
    // Old format: http://apps.uclan.ac.uk/MvCRoomTimetable/CM/CM017
    // New format: https://apps.uclan.ac.uk/TimeTables/SpanWeek/WkMatrixNow?entId=CM017&entType=Room
    return `${SPANWEEK_BASE_URL}?entId=${roomName}&entType=Room`;
}

// SpanWeek format uses different CSS classes than MvCRoomTimetable
const VALID_EVENT_CLASSNAMES = [
    "scan_open",
    "TimeTableEvent",
    "TimeTableCurrentEvent",
    "TimeTableClash",
];
const DAY_NAME_COLUMN_CLASSNAMES = [
    "TimeTableRowHeader",
    "TimeTableCurrentRowHeader",
];
const daysOfWeek = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

const readBuildingsFromCSV = async (filePath: string): Promise<Building[]> => {
    let buildings: Building[] = [];

    return new Promise((resolve, reject) => {
        createReadStream(filePath)
            .pipe(parseCSV({ delimiter: ",", from_line: 2 })) // Assuming the first row is headers
            .on("data", (row) => {
                buildings.push({
                    name: row[0].trim(),
                    latitude: parseFloat(row[1].trim()),
                    longitude: parseFloat(row[2].trim()),
                    address: row[3].trim(),
                    code: row[4].trim().toUpperCase(),
                });
            })
            .on("end", () => {
                resolve(buildings);
            })
            .on("error", (error) => {
                reject(error);
            });
    });
};

const readRoomsFromCSV = async (
    outArr: Room[],
    filePath: string
): Promise<Building[]> => {
    const rooms: Building[] = [];

    return new Promise((resolve, reject) => {
        createReadStream(filePath)
            .pipe(parseCSV({ delimiter: ",", from_line: 2 })) // Skip header row
            .on("data", (row) => {
                outArr.push({
                    buildingCode: row[0].trim(),
                    name: row[1].trim(),
                    url: row[2].trim(),
                });
            })
            .on("end", () => {
                resolve(rooms);
            })
            .on("error", (error) => {
                reject(error);
            });
    });
};

async function scrapeRoomTimeTable(
    roomUrl: string,
    roomName: string
): Promise<TimetableEntry[]> {
    // console.log(`Fetching timetable for ${roomName}... (${roomUrl})`);
    let output: TimetableEntry[] = [];

    try {
        // Convert to SpanWeek URL format (which includes group info)
        const spanWeekUrl = convertToSpanWeekUrl(roomUrl, roomName);
        const authHeader = getAuthHeader();
        
        // Build headers
        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0',
        };
        
        if (authHeader) {
            headers['Authorization'] = authHeader;
        }

        // 1. Fetch the HTML content
        const response = await fetch(spanWeekUrl, {
            headers,
            redirect: 'follow',
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch ${spanWeekUrl}: Status ${response.status}`);
        }

        console.log(`Response status for ${roomName}: ${response.status}`);
        // Check if the response is HTML
        
        const html = await response.text();

        // 2. Parse the HTML using cheerio
        const $ = cheerio.load(html);

        // 3. Select and iterate through table rows
        const rows = $(".TimeTableTable tr");

        rows.each((rowIdx, trElement) => {
            const $row = $(trElement);
            const columns = $row.find("td");

            if (columns.length === 0) return; // Skip header rows or rows without TDs

            // --- Get Day Name ---
            // SpanWeek format: day name is in <th> element, full name like "Monday"
            // MvCRoomTimetable format: day name is in first <td>, abbreviated like "Mon"
            let dayFullName: string = "";
            
            const thElement = $row.find("th.TimeTableRowHeader, th.TimeTableCurrentRowHeader").first();
            if (thElement.length > 0) {
                // SpanWeek format - extract day name from th (e.g., "Monday 24/11/2025")
                const thText = thElement.text().trim();
                // Extract just the day name (first word)
                const dayMatch = thText.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
                if (dayMatch) {
                    dayFullName = dayMatch[1];
                    // Capitalize first letter
                    dayFullName = dayFullName.charAt(0).toUpperCase() + dayFullName.slice(1).toLowerCase();
                }
            } else {
                // MvCRoomTimetable format - day name in first td (abbreviated)
                const dayNameColumnText = $(columns[0]).text().trim();
                dayFullName = getDayFullNameFromAbbreviation(
                    dayNameColumnText as DayAbbreviation
                );
            }

            // Skip the row if it's not a valid day name
            if (!daysOfWeek.includes(dayFullName)) {
                return;
            }

            const dayDate = getNextOccurrenceOfDay(dayFullName);

            // --- Iterate through columns (timetable slots) ---
            columns.each((colIdx, tdElement) => {
                const tdCheerio = $(tdElement);
                const className = tdCheerio.attr('class') || '';

                // SpanWeek uses compound classes like "TimeTableEvent CompulsAll FirstRow Teach"
                // Check if any of the valid event classnames are present in the class string
                const hasEventClass = VALID_EVENT_CLASSNAMES.some(validClass => 
                    className.includes(validClass)
                );

                if (hasEventClass) {

                    // --- Extract Text, handling <br> as newline ---
                    const tempTd = tdCheerio.clone();
                    tempTd.find('br').replaceWith('\n');
                    const columnText = tempTd.text().trim();

                    if (columnText) {
                        // For clash cells, split into multiple event blocks by time pattern
                        // Each event starts with a time like "10:00 - 13:00"
                        const isClashCell = className === 'TimeTableClash';
                        
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
                        
                        // Process each event block
                        for (const splitText of eventBlocks) {
                            if (splitText.length < 2) continue; // Need at least time and module
                            
                            // Use pattern matching to identify fields
                            let time: string | null = null;
                            let module: string | null = null;
                            let lecturer: string | null = null;
                            let sessionType: string | null = null;  // e.g., "Lecture (On Campus)"
                            let groupCohort: string | null = null;  // e.g., "/CS1", "Full_Group"

                            for (const line of splitText) {
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

                                // SpanWeek Group/Cohort pattern: "(Group: /CS1)" or "(Group: Full_Group)" on its own line
                                // Extract just the cohort part (e.g., "/CS1", "Full_Group")
                                const cohortMatch = line.match(/^\(Group:\s*([^\)]+)\)\s*$/i);
                                if (!groupCohort && cohortMatch) {
                                    groupCohort = cohortMatch[1].trim();
                                    continue;
                                }

                                // Session type patterns: e.g., "Lecture (On Campus)", "Practical (On Campus)"
                                if (!sessionType && /^(Lecture|Practical|Seminar|Workshop|Tutorial|Lab|Placement|Project|Exam|Assessment|Drop[\s-]?in|Non[\s-]?Teaching)/i.test(line)) {
                                    sessionType = line;
                                    continue;
                                }
                                if (!sessionType && /\((On\s*Campus|Online|Hybrid)\)\s*$/i.test(line)) {
                                    sessionType = line;
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

                            // group field = just the cohort (e.g., "/CS1", "Full_Group")
                            // sessionType is separate (e.g., "Practical (On Campus)")
                            const finalGroup = groupCohort || "";

                            // Only proceed if we have at least time and module
                            if (time && module) {
                                const topIdx = rowIdx + 1;
                                const slotInDay = colIdx;

                                try {
                                    const [startTime, endTime] = time.split(" - ");
                                    if (!startTime || !endTime) {
                                         console.warn(`Skipping entry due to invalid time format: "${time}" in ${roomName} on ${dayFullName}`);
                                         continue;
                                    }

                                    const startDate = parse(startTime.trim(), "HH:mm", dayDate);
                                    const endDate = parse(endTime.trim(), "HH:mm", dayDate);

                                    const startDateString = format(startDate, "yyyy-MM-dd'T'HH:mm:ss");
                                    const endDateString = format(endDate, "yyyy-MM-dd'T'HH:mm:ss");

                                    output.push({
                                        topIdx,
                                        slotInDay,
                                        time,
                                        module,
                                        lecturer: lecturer || "",
                                        group: finalGroup,
                                        roomName,
                                        day: dayFullName,
                                        startDateString,
                                        endDateString,
                                    });
                                } catch (parseError) {
                                     console.warn(`Skipping entry due to date parsing error for time "${time}" in ${roomName} on ${dayFullName}:`, parseError);
                                }
                            } else {
                                console.warn(`Skipping entry: couldn't identify time or module in ${roomName} on ${dayFullName}:`, splitText);
                            }
                        }
                    }
                }
            });
        });

    } catch (error) {
        console.error(`Error scraping timetable for ${roomName} (${roomUrl}):`, error);
        // Depending on requirements, you might want to re-throw the error
        // or return an empty array / partial results.
        // throw error;
    }

    // console.log(`Finished scraping for ${roomName}. Found ${output.length} entries.`);
    return output;
}

export {
    readBuildingsFromCSV,
    readRoomsFromCSV,
    scrapeRoomTimeTable,
};

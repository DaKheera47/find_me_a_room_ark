import { parse as parseCSV } from "csv-parse";
import { createObjectCsvWriter } from "csv-writer";
import { format, parse } from "date-fns";
import { createReadStream } from "fs";
import locateChrome from "locate-chrome";
import puppeteer from "puppeteer";
import * as cheerio from 'cheerio';
import {
    DayAbbreviation,
    getDayFullNameFromAbbreviation,
    getNextOccurrenceOfDay,
} from "./utils";

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

const getRoomLinks = async () => {
    const roomsByBuilding: { [key: string]: Room[] } = {};
    const executablePath: string = await new Promise(resolve => locateChrome((arg: any) => resolve(arg))) || '';

    const browser = await puppeteer.launch({
        executablePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox"], // Add these arguments
    });
    const page = await browser.newPage();
    await page.goto("https://apps.uclan.ac.uk/MvCRoomTimetable/", {
        waitUntil: "domcontentloaded",
    });

    const buildings = await readBuildingsFromCSV(
        "./static/preston_buildings.csv"
    );

    for (const building of buildings) {
        if (building.code === "LIB") continue;

        const buildingUrl = `https://apps.uclan.ac.uk/MvCRoomTimetable/${building.code}`;
        await page.goto(buildingUrl, { waitUntil: "load" });

        console.log(`Scraping rooms for ${building.name}... (${buildingUrl})`);

        // Using Page.$$() to find all 'a' elements representing rooms
        const roomElementHandles = await page.$$("a");

        const rooms = await Promise.all(
            roomElementHandles.map(async (handle) => {
                const name = await (
                    await handle.getProperty("textContent")
                ).jsonValue();
                const url = await (
                    await handle.getProperty("href")
                ).jsonValue();
                return { name, url };
            })
        );

        // Initialize the array for this building code if it doesn't exist
        if (!roomsByBuilding[building.code]) {
            roomsByBuilding[building.code] = [];
        }

        // Iterate through the rooms and add them if they don't already exist
        for (const room of rooms) {
            // Create a unique identifier for the room
            const uniqueRoomId = `${building.code}-${room.name}`;

            // Check if this room is already in the list for the building
            if (
                !roomsByBuilding[building.code].some(
                    (r) => `${r.buildingCode}-${r.name}` === uniqueRoomId
                )
            ) {
                roomsByBuilding[building.code].push({
                    buildingCode: building.code,
                    name: room.name ?? "",
                    url: `http://apps.uclan.ac.uk/MvCRoomTimetable/${building.code}/${room.name}`,
                });
            }
        }
    }

    await browser.close();

    return roomsByBuilding;
};

async function scrapeRoomTimeTable(
    roomUrl: string,
    roomName: string
): Promise<TimetableEntry[]> {
    // console.log(`Fetching timetable for ${roomName}... (${roomUrl})`);
    let output: TimetableEntry[] = [];

    try {
        // 1. Fetch the HTML content
        const response = await fetch(roomUrl, {
            // Add headers to mimic a browser, potentially avoiding blocks
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch ${roomUrl}: Status ${response.status}`);
        }

        console.log(`Response status for ${roomName}: ${response.status}`);
        // Check if the response is HTML
        
        const html = await response.text();

        // 2. Parse the HTML using cheerio
        const $ = cheerio.load(html);

        // 3. Select and iterate through table rows
        const rows = $(".TimeTableTable tr");

        rows.each((rowIdx, trElement) => {
            const columns = $(trElement).find("td");

            if (columns.length === 0) return; // Skip header rows or rows without TDs

            // --- Get Day Name ---
            // Use cheerio's text() which usually handles basic whitespace from HTML structure
            const dayNameColumnText = $(columns[0]).text().trim();
            const dayFullName = getDayFullNameFromAbbreviation(
                dayNameColumnText as DayAbbreviation // Be careful with type assertion
            );

            // Skip the row if it's not a valid day name
            if (!daysOfWeek.includes(dayFullName)) {
                return;
            }

            const dayDate = getNextOccurrenceOfDay(dayFullName);

            // --- Iterate through columns (timetable slots) ---
            columns.each((colIdx, tdElement) => {
                const tdCheerio = $(tdElement);
                const className = tdCheerio.attr('class') || '';

                if (VALID_EVENT_CLASSNAMES.includes(className)) {

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
                            let group: string | null = null;

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
                                        group: group || "",
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
const writeRoomsToCSV = async (filePath: string) => {
    // read rooms from csv
    const roomsByBuilding = await getRoomLinks();

    const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: [
            { id: "buildingCode", title: "Building Code" },
            { id: "name", title: "Room Name" },
            { id: "url", title: "Room URL" },
        ],
    });

    const records: any[] = [];
    Object.values(roomsByBuilding).forEach((rooms) => {
        rooms.forEach((room) => {
            records.push(room);
        });
    });

    await csvWriter.writeRecords(records);
};

export {
    getRoomLinks,
    readBuildingsFromCSV,
    readRoomsFromCSV,
    scrapeRoomTimeTable,
    writeRoomsToCSV,
};

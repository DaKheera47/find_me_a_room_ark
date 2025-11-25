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
                    // Clone to avoid modifying the original structure for subsequent operations if needed elsewhere
                    const tempTd = tdCheerio.clone();
                    // Replace <br> tags specifically with newline characters within this cell's HTML
                    tempTd.find('br').replaceWith('\n');
                    // Get the text content, now with newlines where <br> tags were
                    const columnText = tempTd.text().trim();
                    // Alternative if the above doesn't work well:
                    // const innerHtml = tdCheerio.html() || '';
                    // const textWithNewlines = innerHtml.replace(/<br\s*\/?>/gi, '\n');
                    // const columnText = $(`<div>${textWithNewlines}</div>`).text().trim(); // Use cheerio again to strip remaining tags

                    if (columnText) {
                        const splitText = columnText.split("\n").map(s => s.trim()).filter(Boolean); // Split and clean up parts

                        if (splitText.length >= 4) { // Ensure we have enough parts
                            const time = splitText[0];
                            const module = splitText[1];
                            const lecturer = splitText[2];
                            const group = splitText[3];

                            // rowIdx from .each is 0-based, original Puppeteer used 1-based 'topIdx'
                            const topIdx = rowIdx + 1;
                            // colIdx from .each is 0-based, original Puppeteer used 1-based 'slotInDay' (assuming first col isn't a slot)
                            const slotInDay = colIdx; // Adjust if col 0 (day name) shouldn't count

                            try {
                                const [startTime, endTime] = time.split(" - ");
                                if (!startTime || !endTime) {
                                     console.warn(`Skipping entry due to invalid time format: "${time}" in ${roomName} on ${dayFullName}`);
                                     return; // Skip this entry if time format is wrong
                                }

                                // Combine dayDate with startTime for full start dateTime
                                const startDate = parse(startTime.trim(), "HH:mm", dayDate);
                                const endDate = parse(endTime.trim(), "HH:mm", dayDate);

                                const startDateString = format(startDate, "yyyy-MM-dd'T'HH:mm:ss");
                                const endDateString = format(endDate, "yyyy-MM-dd'T'HH:mm:ss");


                                output.push({
                                    topIdx,
                                    slotInDay,
                                    time,
                                    module,
                                    lecturer,
                                    group,
                                    roomName,
                                    day: dayFullName,
                                    startDateString,
                                    endDateString,
                                });
                            } catch (parseError) {
                                 console.warn(`Skipping entry due to date parsing error for time "${time}" in ${roomName} on ${dayFullName}:`, parseError);
                            }
                        } else {
                             console.warn(`Skipping entry due to insufficient data parts after splitting text in ${roomName} on ${dayFullName}:`, columnText);
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

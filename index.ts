import { parse as parseCSV } from "csv-parse";
import { createObjectCsvWriter } from "csv-writer";
import { format, parse } from "date-fns";
import { createReadStream } from "fs";
import puppeteer from "puppeteer";
import {
    DayAbbreviation,
    getDayFullNameFromAbbreviation,
    getNextOccurrenceOfDay,
} from "./utils";

const buildings: Building[] = [];
let rooms: Room[] = [];
const roomsByBuilding: { [key: string]: Room[] } = {};
const VALID_EVENT_CLASSNAMES = ["scan_open", "TimeTableEvent"];
const DAY_NAME_COLUMN_CLASSNAMES = [
    "TimeTableRowHeader",
    "TimeTableCurrentRowHeader",
];

const readBuildingsFromCSV = async (filePath: string): Promise<void> => {
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
                resolve();
            })
            .on("error", (error) => {
                reject(error);
            });
    });
};

const readRoomsFromCSV = async (filePath: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        createReadStream(filePath)
            .pipe(parseCSV({ delimiter: "," }))
            .on("data", (row) => {
                rooms.push({
                    buildingCode: row[0].trim(),
                    name: row[1].trim(),
                    url: row[2].trim(),
                });
            })
            .on("end", () => {
                resolve();
            })
            .on("error", (error) => {
                reject(error);
            });
    });
};

const getRoomLinks = async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto("https://apps.uclan.ac.uk/MvCRoomTimetable/", {
        waitUntil: "domcontentloaded",
    });

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
};

async function scrapeRoomTimeTable(
    roomUrl: string,
    roomName: string
): Promise<void> {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    let output: any = [];

    await page.goto(roomUrl);

    const rows = await page.$$eval(".TimeTableTable tr", (trs) =>
        trs.map((tr) => {
            return Array.from(tr.querySelectorAll("td"), (td) => {
                // First, replace <br> tags with \n
                const innerHtmlWithNewLines = td.innerHTML.replace(
                    /<br\s*\/?>/gi,
                    "\n"
                );
                // Then, create a temporary div element and set its innerHTML to the modified HTML
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = innerHtmlWithNewLines;
                // Finally, extract the textContent, which will not contain any HTML tags
                const text = tempDiv.textContent || tempDiv.innerText || "";
                return {
                    text: text,
                    className: td.className,
                };
            });
        })
    );

    rows.forEach((row, rowIdx) => {
        const dayNameColumn = row[0].text.replace(/\n/g, "");
        const dayFullName = getDayFullNameFromAbbreviation(
            dayNameColumn as DayAbbreviation
        );
        const dayDate = getNextOccurrenceOfDay(dayFullName);

        row.forEach((column, colIdx) => {
            if (VALID_EVENT_CLASSNAMES.includes(column.className)) {
                const columnText = column.text;
                if (columnText) {
                    // Now, 'text' has \n for <br> and no HTML tags
                    const splitText = columnText.split("\n");

                    const time = splitText[0];
                    const module = splitText[1];
                    const lecturer = splitText[2];
                    const group = splitText[3];

                    const topIdx = rowIdx + 1;
                    const slotInDay = colIdx + 1;

                    // Assuming 'time' is in 'HH:mm - HH:mm'
                    const [startTime, endTime] = splitText[0].split(" - ");
                    // Combine dayDate with startTime for full start dateTime
                    const startDateString = format(
                        parse(startTime, "HH:mm", dayDate),
                        "yyyy-MM-dd'T'HH:mm:ss"
                    );

                    // Optionally, combine dayDate with endTime for full end dateTime
                    const endDateString = format(
                        parse(endTime, "HH:mm", dayDate),
                        "yyyy-MM-dd'T'HH:mm:ss"
                    );

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
                }
            }
        });
    });

    await browser.close();
    return output;
}

const writeRoomsToCSV = async (filePath: string) => {
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

const main = async () => {
    // await readBuildingsFromCSV("./static/preston_buildings.csv");
    // await getRoomLinks();
    // await writeRoomsToCSV("./out/rooms_grouped.csv");

    // read rooms from csv
    await readRoomsFromCSV("./out/rooms_grouped.csv");

    // limit to 5 rooms from cm building
    rooms = rooms.filter((room) => room.buildingCode === "CM").slice(0, 1);

    // scrape room timetable
    for (const room of rooms) {
        console.log(`Scraping ${room.name}... (${room.url})`);
        const scrapeResult = await scrapeRoomTimeTable(room.url, room.name);
        // const scrapeResult = await scrapeRoomTimeTable(
        //     "https://apps.uclan.ac.uk/MvCRoomTimetable/CM/CM034",
        //     "CM034"
        // );
        console.log(scrapeResult);
    }

    // scrapeRoomTimeTable("http://apps.uclan.ac.uk/MvCRoomTimetable/CM/CM034");
};

main().catch(console.error);

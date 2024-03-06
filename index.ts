import puppeteer from "puppeteer";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import { createObjectCsvWriter } from "csv-writer";

const buildings: Building[] = [];
const roomsByBuilding: { [key: string]: Room[] } = {};
const VALID_EVENT_CLASSNAMES = ["scan_open", "TimeTableEvent"];

const readBuildingsFromCSV = async (filePath: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        createReadStream(filePath)
            .pipe(parse({ delimiter: ",", from_line: 2 })) // Assuming the first row is headers
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

async function scrapeRoomTimeTable(roomUrl: string): Promise<void> {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(roomUrl);

    const rows = await page.$$eval(".TimeTableTable tr", (trs) =>
        trs.slice(1).map((tr) => {
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
            }).slice(1);
        })
    );

    rows.forEach((row, rowIdx) => {
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

                    console.log({
                        topIdx,
                        slotInDay,
                        time,
                        module,
                        lecturer,
                        group,
                    });
                }
            }
        });
    });

    await browser.close();
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
    scrapeRoomTimeTable("http://apps.uclan.ac.uk/MvCRoomTimetable/CM/CM234");
};

main().catch(console.error);

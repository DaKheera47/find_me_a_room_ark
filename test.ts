import { scrapeRoomTimeTable } from "./scraping";

console.log("Scraping room time table");

scrapeRoomTimeTable(
    "http://apps.uclan.ac.uk/MvCRoomTimetable/BB/BB213",
    "BB213"
).then((roomTimeTable) => {
    console.log("Room time table", roomTimeTable);
});

import { Router } from "express";
import {
    readBuildingsFromCSV,
    readRoomsFromCSV,
    scrapeRoomTimeTable,
} from "../scraping";

const scrapeRoomRouter = Router();

scrapeRoomRouter.post("/get-available-rooms-in-building", async (req, res) => {
    const { buildingCode } = req.body as { buildingCode: BuildingCode };

    console.log(
        "REQUEST AT /get-available-rooms-in-building",
        req.body,
        buildingCode,
        new Date().toISOString()
    );

    if (!buildingCode) {
        return res
            .status(400)
            .send({ error: "Missing buildingCode in request body." });
    }

    // read rooms from csv
    const buildings = await readBuildingsFromCSV(
        "./static/preston_buildings.csv"
    );

    // for the building code, get the rooms
    const building = buildings.find(
        (building) => building.code === buildingCode
    );

    if (!building) {
        return res.status(404).send({ error: "Building not found." });
    }

    // read rooms from csv
    let rooms: Room[] = [];
    await readRoomsFromCSV(rooms, "./out/rooms_grouped.csv");
});

export default scrapeRoomRouter;

import cors from "cors";
import express from "express";
import isRoomFreeRouter from "./routes/is-room-free";
import scrapeRoomRouter from "./routes/get-room-timetable";
import getAllRoomInfoRouter from "./routes/get-all-room-info";
import getAvailableRoomsInBuildingRouter from "./routes/get-available-rooms-in-building";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Hello World!");
});

// Endpoint to scrape a specific room's timetable
app.use(scrapeRoomRouter);

app.use(isRoomFreeRouter);

app.use(getAllRoomInfoRouter);

app.use(getAvailableRoomsInBuildingRouter);

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

import cors from "cors";
import express from "express";
import isRoomFreeRouter from "./routes/is-room-free";
import scrapeRoomRouter from "./routes/get-room-timetable";
import getAllRoomInfoRouter from "./routes/get-all-room-info";
import getAvailableRoomsInBuildingRouter from "./routes/get-available-rooms-in-building";
import healthRouter from "./routes/health";
import findRoomsByDurationRouter from "./routes/find-rooms-by-duration";
import lecturersRouter from "./routes/lecturers-db";

const app = express();
const port = process.env.PORT || 8072;

app.use(cors());
process.setMaxListeners(20); // Or higher, calculate based on max expected parallelism

// Middleware to parse JSON bodies
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Welcome to the Room Timetable API!");
});

// Endpoint to scrape a specific room's timetable
app.use(scrapeRoomRouter);

app.use(isRoomFreeRouter);

app.use(getAllRoomInfoRouter);

app.use(getAvailableRoomsInBuildingRouter);

app.use(healthRouter);

app.use(findRoomsByDurationRouter);

app.use(lecturersRouter);

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

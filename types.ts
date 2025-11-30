type BuildingCode =
    | "AB"
    | "AL"
    | "BB"
    | "CB"
    | "CM"
    | "DB"
    | "ER"
    | "EB"
    | "EIC"
    | "FB"
    | "GR"
    | "HR"
    | "HA"
    | "HB"
    | "KM"
    | "LE"
    | "LH"
    | "MB"
    | "ME"
    | "SU"
    | "VE"
    | "VB"
    | "WB"
    | "33ES"
    | "LIB"
    | "53";

interface Building {
    name: string;
    latitude: number;
    longitude: number;
    address: string;
    code: BuildingCode;
}

interface TimetableEntry {
    topIdx: number;
    slotInDay: number;
    time: string;
    module: string;
    lecturer: string;
    group: string;
    sessionType: string;
    roomName: string;
    day: string;
    startDateString: string;
    endDateString: string;
}

interface ScrapeRoomRequestBody {
    roomName: string;
}

interface Room {
    buildingCode: BuildingCode;
    name: string;
    url: string;
}

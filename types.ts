interface Building {
    name: string;
    latitude: number;
    longitude: number;
    address: string;
    code: string;
}

interface Room {
    buildingCode: string;
    name: string;
    url: string;
}

interface TimetableEntry {
    topIdx: number;
    slotInDay: number;
    time: string;
    module: string;
    lecturer: string;
    group: string;
    roomName: string;
    day: string;
    startDateString: string;
    endDateString: string;
}

interface ScrapeRoomRequestBody {
    roomName: string;
}

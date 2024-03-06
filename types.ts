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

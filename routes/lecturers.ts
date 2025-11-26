import { Router } from "express";
import { readRoomsFromCSV, scrapeRoomTimeTable } from "../scraping";

const CACHE_TTL_MS =
  process.env.NODE_ENV === "development" ? 15 : 15 * 60 * 1000; // 15 minutes in production

type LecturerCacheEntry = {
  name: string;
  timetable: TimetableEntry[];
};

type LecturerCache = {
  generatedAt: number;
  lecturers: Record<string, LecturerCacheEntry>;
};

let lecturerCache: LecturerCache | null = null;
let inflightBuild: Promise<LecturerCache> | null = null;

const lecturersRouter = Router();

const LECTURER_EXCLUSION_KEYWORDS = [
  "tbc",
  "vacant",
  "available",
  "not set",
  "week",
  "term",
  "session",
  "module",
  "lecture",
  "group",
  "slot",
  "enc.",
  "cc",
];

const titleCaseSegment = (segment: string): string => {
  const lower = segment.toLowerCase();
  return lower.replace(/(^|[\s,.'’-])([a-z])/g, (match, prefix, letter) => {
    return `${prefix}${letter.toUpperCase()}`;
  });
};

const normaliseLecturerName = (name: string): string => {
  const trimmed = name.trim();
  const hasMixedCase = /[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed);

  if (hasMixedCase) {
    return trimmed.replace(/\s+,/g, ",").replace(/,\s+/g, ", ");
  }

  return trimmed
    .split(",")
    .map((segment) => titleCaseSegment(segment.trim()))
    .join(", ")
    .replace(/\s+,/g, ",");
};

const extractLecturerNames = (raw: string): string[] => {
  if (!raw) {
    return [];
  }

  const withoutParens = raw.replace(/\(.*?\)/g, " ");
  const compact = withoutParens.replace(/\s+/g, " ").trim();

  if (!compact) {
    return [];
  }

  const candidates = compact
    .split(/\s*(?:\/|&amp;|&|\band\b)\s*/gi)
    .flatMap((piece) => piece.split(/\s*;\s*/g));

  const results = new Set<string>();

  candidates.forEach((candidate) => {
    let cleaned = candidate
      .replace(/^[-–—]+/, "")
      .replace(/[–—-]+$/, "")
      .replace(/^Lecturer:?\s*/i, "")
      .replace(/^Tutor:?\s*/i, "")
      .replace(/\s+,/g, ",")
      .replace(/,\s+/g, ", ")
      .trim();

    if (!cleaned) {
      return;
    }

    const lower = cleaned.toLowerCase();

    if (
      LECTURER_EXCLUSION_KEYWORDS.some((keyword) => lower.includes(keyword))
    ) {
      return;
    }

    if (/\d/.test(cleaned)) {
      return;
    }

    if (!/[a-zA-Z]/.test(cleaned)) {
      return;
    }

    if (!/[,\s]/.test(cleaned)) {
      return;
    }

    cleaned = normaliseLecturerName(cleaned);

    if (cleaned.length < 3 || cleaned.length > 80) {
      return;
    }

    results.add(cleaned);
  });

  return Array.from(results);
};

const sortByStartDate = (entries: TimetableEntry[]): TimetableEntry[] => {
  return [...entries].sort((a, b) => {
    const aTime = new Date(a.startDateString).getTime();
    const bTime = new Date(b.startDateString).getTime();
    return aTime - bTime;
  });
};

const buildLecturerCache = async (): Promise<LecturerCache> => {
  let rooms: Room[] = [];
  await readRoomsFromCSV(rooms, "./out/rooms_grouped.csv");

  const results = await Promise.allSettled(
    rooms.map((room) => scrapeRoomTimeTable(room.url, room.name))
  );

  const lecturerMap: Record<string, LecturerCacheEntry> = {};

  results.forEach((result) => {
    if (result.status !== "fulfilled") {
      return;
    }

    result.value.forEach((entry) => {
      const names = extractLecturerNames(entry.lecturer || "");

      names.forEach((name) => {
        const key = name.toLowerCase();

        if (!lecturerMap[key]) {
          lecturerMap[key] = {
            name,
            timetable: [],
          };
        }

        const normalisedEntry: TimetableEntry = {
          ...entry,
          lecturer: name,
        };

        const alreadyIncluded = lecturerMap[key].timetable.some(
          (existing) =>
            existing.startDateString === normalisedEntry.startDateString &&
            existing.endDateString === normalisedEntry.endDateString &&
            existing.roomName === normalisedEntry.roomName &&
            existing.module === normalisedEntry.module
        );

        if (!alreadyIncluded) {
          lecturerMap[key].timetable.push(normalisedEntry);
        }
      });
    });
  });

  Object.values(lecturerMap).forEach((entry) => {
    entry.timetable = sortByStartDate(entry.timetable);
  });

  return {
    generatedAt: Date.now(),
    lecturers: lecturerMap,
  };
};

const getLecturerCache = async (forceRefresh = false) => {
  const now = Date.now();

  if (!forceRefresh && lecturerCache) {
    const isFresh = now - lecturerCache.generatedAt < CACHE_TTL_MS;
    if (isFresh) {
      return lecturerCache;
    }
  }

  if (!inflightBuild) {
    inflightBuild = buildLecturerCache()
      .then((cache) => {
        lecturerCache = cache;
        inflightBuild = null;
        return cache;
      })
      .catch((error) => {
        inflightBuild = null;
        throw error;
      });
  }

  return inflightBuild;
};

lecturersRouter.get("/lecturers", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "true";
    const cache = await getLecturerCache(forceRefresh);

    const lecturerNames = Object.values(cache.lecturers)
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    res.json({
      lecturers: lecturerNames,
      generatedAt: new Date(cache.generatedAt).toISOString(),
    });
  } catch (error) {
    console.error("Failed to build lecturer cache", error);
    res.status(500).json({ error: "Failed to load lecturers" });
  }
});

lecturersRouter.get("/lecturers/:lecturerName", async (req, res) => {
  try {
    const rawLecturerName = req.params.lecturerName;
    const decodedName = decodeURIComponent(rawLecturerName || "");

    if (!decodedName) {
      return res.status(400).json({ error: "Missing lecturer name" });
    }

    const cleanedCandidates = extractLecturerNames(decodedName);
    const lookupName =
      cleanedCandidates[0] ?? normaliseLecturerName(decodedName);

    if (!lookupName) {
      return res
        .status(404)
        .json({ error: `Lecturer ${decodedName} not found` });
    }

    const cache = await getLecturerCache(false);
    const lookupKey = lookupName.toLowerCase();

    const match = cache.lecturers[lookupKey];

    if (!match) {
      return res
        .status(404)
        .json({ error: `Lecturer ${decodedName} not found` });
    }

    res.json({
      lecturer: match.name,
      timetable: match.timetable,
      generatedAt: new Date(cache.generatedAt).toISOString(),
    });
  } catch (error) {
    console.error("Failed to load lecturer timetable", error);
    res.status(500).json({ error: "Failed to load lecturer timetable" });
  }
});

export default lecturersRouter;

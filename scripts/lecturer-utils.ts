/**
 * Lecturer name extraction and normalization utilities
 * Extracted from routes/lecturers.ts for reuse in scraping
 */

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

/**
 * Title-case a name segment
 */
export function titleCaseSegment(segment: string): string {
    const lower = segment.toLowerCase();
    return lower.replace(/(^|[\s,.''-])([a-z])/g, (match, prefix, letter) => {
        return `${prefix}${letter.toUpperCase()}`;
    });
}

/**
 * Normalize a lecturer name to consistent format
 */
export function normaliseLecturerName(name: string): string {
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
}

/**
 * Extract individual lecturer names from a raw string
 * Handles multiple lecturers separated by /, &, and, ;
 */
export function extractLecturerNames(raw: string): string[] {
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

        if (LECTURER_EXCLUSION_KEYWORDS.some((keyword) => lower.includes(keyword))) {
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
}

/**
 * Sort timetable entries by start date
 */
export function sortByStartDate<T extends { startDateString: string }>(entries: T[]): T[] {
    return [...entries].sort((a, b) => {
        const aTime = new Date(a.startDateString).getTime();
        const bTime = new Date(b.startDateString).getTime();
        return aTime - bTime;
    });
}

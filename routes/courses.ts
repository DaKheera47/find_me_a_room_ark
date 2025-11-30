import { Router } from "express";
import { getDatabase } from "../scripts/db";

const coursesRouter = Router();

interface Course {
    id: number;
    url: string;
    type: string;
    title: string;
}

interface CourseYear {
    id: number;
    label: string;
    year_order: number;
}

interface CourseModule {
    code: string;
    name: string;
    description: string | null;
    type: string;
}

/**
 * GET /courses
 * Returns list of all courses with optional filtering by type
 * Query params:
 *   - type: "undergrad" | "postgrad" (optional)
 *   - search: string to search in title (optional)
 */
coursesRouter.get("/courses", (req, res) => {
    try {
        const db = getDatabase();
        if (!db) {
            return res.status(503).json({ error: "Database not available" });
        }

        const { type, search } = req.query;

        let query = `SELECT id, url, type, title FROM courses WHERE 1=1`;
        const params: (string | number)[] = [];

        if (type === "undergrad" || type === "postgrad") {
            query += ` AND type = ?`;
            params.push(type);
        }

        if (search && typeof search === "string" && search.trim()) {
            query += ` AND title LIKE ?`;
            params.push(`%${search.trim()}%`);
        }

        query += ` ORDER BY title ASC`;

        const courses = db.prepare(query).all(...params) as Course[];
        db.close();

        res.json({
            courses,
            count: courses.length,
        });
    } catch (error) {
        console.error("Failed to load courses", error);
        res.status(500).json({ error: "Failed to load courses" });
    }
});

/**
 * GET /courses/:courseId
 * Returns a single course with its years and modules
 */
coursesRouter.get("/courses/:courseId", (req, res) => {
    try {
        const courseId = parseInt(req.params.courseId, 10);

        if (isNaN(courseId)) {
            return res.status(400).json({ error: "Invalid course ID" });
        }

        const db = getDatabase();
        if (!db) {
            return res.status(503).json({ error: "Database not available" });
        }

        // Get course info
        const course = db
            .prepare(`SELECT id, url, type, title FROM courses WHERE id = ?`)
            .get(courseId) as Course | undefined;

        if (!course) {
            db.close();
            return res.status(404).json({ error: "Course not found" });
        }

        // Get years with modules
        const years = db
            .prepare(
                `
                SELECT id, label, year_order
                FROM course_years
                WHERE course_id = ?
                ORDER BY year_order ASC
            `
            )
            .all(courseId) as CourseYear[];

        const yearsWithModules = years.map((year) => {
            const modules = db
                .prepare(
                    `
                    SELECT module_code as code, module_name as name, description, section_type as type
                    FROM course_modules
                    WHERE course_year_id = ?
                    ORDER BY section_type ASC, module_name ASC
                `
                )
                .all(year.id) as CourseModule[];

            const compulsory = modules.filter((m) => m.type === "compulsory");
            const optional = modules.filter((m) => m.type === "optional");
            const other = modules.filter((m) => m.type === "other");

            return {
                id: year.id,
                label: year.label,
                compulsoryModules: compulsory,
                optionalModules: optional,
                otherModules: other,
            };
        });

        db.close();

        res.json({
            course,
            years: yearsWithModules,
        });
    } catch (error) {
        console.error("Failed to load course details", error);
        res.status(500).json({ error: "Failed to load course details" });
    }
});

/**
 * GET /courses/:courseId/years/:yearId/modules
 * Returns modules for a specific course year
 */
coursesRouter.get("/courses/:courseId/years/:yearId/modules", (req, res) => {
    try {
        const courseId = parseInt(req.params.courseId, 10);
        const yearId = parseInt(req.params.yearId, 10);

        if (isNaN(courseId) || isNaN(yearId)) {
            return res.status(400).json({ error: "Invalid course or year ID" });
        }

        const db = getDatabase();
        if (!db) {
            return res.status(503).json({ error: "Database not available" });
        }

        // Verify the year belongs to the course
        const year = db
            .prepare(
                `
                SELECT cy.id, cy.label, cy.course_id
                FROM course_years cy
                WHERE cy.id = ? AND cy.course_id = ?
            `
            )
            .get(yearId, courseId) as { id: number; label: string; course_id: number } | undefined;

        if (!year) {
            db.close();
            return res.status(404).json({ error: "Course year not found" });
        }

        const modules = db
            .prepare(
                `
                SELECT module_code as code, module_name as name, description, section_type as type
                FROM course_modules
                WHERE course_year_id = ?
                ORDER BY section_type ASC, module_name ASC
            `
            )
            .all(yearId) as CourseModule[];

        db.close();

        const compulsory = modules.filter((m) => m.type === "compulsory");
        const optional = modules.filter((m) => m.type === "optional");
        const other = modules.filter((m) => m.type === "other");

        res.json({
            yearId,
            yearLabel: year.label,
            compulsoryModules: compulsory,
            optionalModules: optional,
            otherModules: other,
            totalModules: modules.length,
        });
    } catch (error) {
        console.error("Failed to load course year modules", error);
        res.status(500).json({ error: "Failed to load course year modules" });
    }
});

/**
 * GET /courses/search/modules?code=CO1007
 * Search for courses that contain a specific module code
 */
coursesRouter.get("/courses/search/modules", (req, res) => {
    try {
        const { code } = req.query;

        if (!code || typeof code !== "string") {
            return res.status(400).json({ error: "Module code is required" });
        }

        const db = getDatabase();
        if (!db) {
            return res.status(503).json({ error: "Database not available" });
        }

        const results = db
            .prepare(
                `
                SELECT DISTINCT 
                    c.id as course_id,
                    c.title as course_title,
                    c.type as course_type,
                    cy.label as year_label,
                    cm.module_code,
                    cm.module_name,
                    cm.section_type
                FROM course_modules cm
                JOIN course_years cy ON cm.course_year_id = cy.id
                JOIN courses c ON cy.course_id = c.id
                WHERE cm.module_code = ?
                ORDER BY c.title, cy.year_order
            `
            )
            .all(code.toUpperCase());

        db.close();

        res.json({
            moduleCode: code.toUpperCase(),
            courses: results,
            count: results.length,
        });
    } catch (error) {
        console.error("Failed to search courses by module", error);
        res.status(500).json({ error: "Failed to search courses by module" });
    }
});

export default coursesRouter;

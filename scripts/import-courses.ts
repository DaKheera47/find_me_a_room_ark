import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { initializeCoursesDatabase } from "./db";

// Types for the course JSON structure
interface CourseModule {
    name: string;
    code: string;
    description: string;
}

interface CourseSection {
    type: "compulsory" | "optional" | string;
    modules: CourseModule[];
}

interface CourseYear {
    label: string;
    sections: CourseSection[];
}

interface CourseData {
    url: string;
    type: "undergrad" | "postgrad";
    title: string;
    years: CourseYear[];
}

const COURSES_DIR = path.join(process.cwd(), "static", "courses");

/**
 * Clear existing course data from the database
 */
function clearCourseData(db: Database.Database): void {
    db.exec(`
        DELETE FROM course_modules;
        DELETE FROM course_years;
        DELETE FROM courses;
    `);
    console.log("Cleared existing course data");
}

/**
 * Import all course JSON files into the database
 */
export function importCourses(db: Database.Database, clearFirst: boolean = true): void {
    if (!fs.existsSync(COURSES_DIR)) {
        console.error(`Courses directory not found: ${COURSES_DIR}`);
        process.exit(1);
    }

    const files = fs.readdirSync(COURSES_DIR).filter((f) => f.endsWith(".json"));
    console.log(`Found ${files.length} course files to import`);

    if (files.length === 0) {
        console.log("No JSON files found in courses directory");
        return;
    }

    // Prepared statements
    const insertCourse = db.prepare(`
        INSERT INTO courses (url, type, title) VALUES (?, ?, ?)
    `);

    const insertYear = db.prepare(`
        INSERT INTO course_years (course_id, label, year_order) VALUES (?, ?, ?)
    `);

    const insertModule = db.prepare(`
        INSERT INTO course_modules (course_year_id, module_code, module_name, description, section_type)
        VALUES (?, ?, ?, ?, ?)
    `);

    // Track stats
    let coursesImported = 0;
    let yearsImported = 0;
    let modulesImported = 0;
    let errors = 0;

    const importAll = db.transaction(() => {
        if (clearFirst) {
            clearCourseData(db);
        }

        for (const file of files) {
            try {
                const filePath = path.join(COURSES_DIR, file);
                const content = fs.readFileSync(filePath, "utf-8");
                const data: CourseData = JSON.parse(content);

                // Validate required fields
                if (!data.url || !data.type || !data.title) {
                    console.warn(`Skipping ${file}: missing required fields (url, type, or title)`);
                    errors++;
                    continue;
                }

                // Normalize type to undergrad/postgrad
                const courseType = data.type === "postgrad" ? "postgrad" : "undergrad";

                // Insert course
                const courseResult = insertCourse.run(data.url, courseType, data.title);
                const courseId = courseResult.lastInsertRowid;
                coursesImported++;

                // Insert years
                if (data.years && Array.isArray(data.years)) {
                    data.years.forEach((year, yearIdx) => {
                        const yearResult = insertYear.run(courseId, year.label, yearIdx);
                        const yearId = yearResult.lastInsertRowid;
                        yearsImported++;

                        // Insert modules from each section
                        if (year.sections && Array.isArray(year.sections)) {
                            for (const section of year.sections) {
                                // Normalize section type
                                let sectionType: string = section.type || "other";
                                if (sectionType !== "compulsory" && sectionType !== "optional") {
                                    sectionType = "other";
                                }

                                if (section.modules && Array.isArray(section.modules)) {
                                    for (const mod of section.modules) {
                                        if (mod.code && mod.name) {
                                            insertModule.run(
                                                yearId,
                                                mod.code,
                                                mod.name,
                                                mod.description || null,
                                                sectionType
                                            );
                                            modulesImported++;
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
            } catch (err) {
                console.error(`Error processing ${file}:`, err);
                errors++;
            }
        }
    });

    importAll();

    console.log("\n=== Import Summary ===");
    console.log(`Courses imported: ${coursesImported}`);
    console.log(`Years imported: ${yearsImported}`);
    console.log(`Modules imported: ${modulesImported}`);
    console.log(`Errors: ${errors}`);
}

// Run if executed directly
if (require.main === module) {
    console.log("Starting course import...\n");

    // Initialize courses database (creates tables if needed)
    const db = initializeCoursesDatabase();

    try {
        importCourses(db, true);
        console.log("\nImport completed successfully!");
    } catch (error) {
        console.error("Import failed:", error);
        process.exit(1);
    } finally {
        db.close();
    }
}

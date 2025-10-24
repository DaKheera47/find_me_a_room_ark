# Repository Guidelines

## Project Structure & Module Organization
- `index.ts` boots the Express API (defaults to port 8072 unless `PORT` is set) and wires the feature routers.
- `routes/*.ts` exposes endpoints (e.g., `is-room-free`, `get-all-room-info`); keep filenames hyphen-case to mirror paths.
- Core logic lives in `scraping.ts`, `date_time_calc.ts`, `utils.ts`, and `types.ts`; reuse shared helpers rather than duplicating parsing code.
- `static/` serves bundled assets, `examples/` holds reference payloads, `out/` stores generated CSV schedules, and `dist/` is build output—never edit the compiled files directly.

## Build, Test, and Development Commands
- `npm install` installs dependencies (Node 20.x). Run it after pulling new modules.
- `npm run build` compiles TypeScript to `dist/` and copies static assets.
- `npm run dev` (or `npm start`) rebuilds then launches `dist/index.js` locally.
- `npm run test` runs the compiled `dist/test.js` integration scrape; expect a live request to the university timetable service.
- `docker-compose up --build free-room-api` builds the image and exposes the API on http://localhost:8072 for parity checks.

## Coding Style & Naming Conventions
- Use TypeScript with 4-space indentation and double quotes, matching the existing modules.
- Keep route handlers as default exports returning an Express `Router`; prefer camelCase for functions/variables and PascalCase for shared types.
- Place multi-use helpers in `utils.ts` or split new domain models into dedicated `*.ts` modules under the root to stay consistent.

## Testing Guidelines
- Extend `test.ts` or add nearby scripts that import `scrapeRoomTimeTable` and related utilities; keep them deterministic by supplying mocked HTML where possible.
- Run `npm run test` before opening a PR and capture console output for regressions; add fixtures under `examples/` if new scenarios are introduced.

## Commit & Pull Request Guidelines
- Follow the short, present-tense style seen in history (e.g., `add examples`, `find rooms b duration`). Keep summaries under ~60 characters.
- Reference related issues in the PR description, outline the change, and note any scraping side effects or new files in `out/`.
- Include manual verification steps (API route hit, docker command, etc.) so reviewers can replay them quickly.

## Environment & Data Handling
- Update `.env` to override `PORT`; when unset, the server listens on 8072.
- Generated CSVs in `out/` are shared assets—validate them before pushing and describe updates when they change.

# UIVerdict — Product Requirements

## Overview

UIVerdict evaluates a public website from a URL. The backend uses Playwright and Lighthouse for visual evidence and performance/accessibility metrics, then Gemini for a structured UI/UX critique and score.

## Core flow

1. A user submits a URL, optionally while authenticated.
2. The backend creates a PostgreSQL analysis record with `PROCESSING` status.
3. Playwright captures temporary local screenshot evidence; Lighthouse gathers metrics.
4. Gemini returns a structured critique based on the screenshot and metrics.
5. The backend stores the completed report in PostgreSQL, marks it `COMPLETED`, and returns its report ID. Failures are marked `FAILED` when the database remains available.
6. The frontend retrieves the report from PostgreSQL through the report-detail endpoint. Reloading the report page fetches it again from the API.

## Data and access requirements

- PostgreSQL accessed through Prisma is the only runtime database.
- Users, projects, ownership relationships, analyses, and completed report fields remain relational PostgreSQL data.
- Authenticated users may retrieve only reports they own.
- A guest may retrieve a guest-owned report only with the signed, report-scoped access cookie issued after analysis.
- Screenshots are temporary analysis inputs. They are removed after success or failure and are not stored in PostgreSQL or remote object storage.
- Analysis metrics and structured critique are persisted with the analysis record. Raw Lighthouse JSON is not a product requirement.
- MongoDB transfer tooling and MongoDB/Mongoose runtime dependencies are not part of the product runtime.

## Non-goals

- Persistent screenshot hosting or screenshot history.
- Multi-page crawling or collaborative annotations.
- MongoDB data transfer; existing MongoDB testing data is disposable.
- Replacing the existing synchronous analysis lifecycle or redesigning unrelated features.

## Reliability and rollout

- Report reads use the PostgreSQL record as their source of truth, not browser storage or mock report data.
- Analysis failures should not remain `PROCESSING` when the database can record `FAILED`.
- Apply Prisma migrations as a separately configured deployment step, not concurrently from each application instance.
- Never reset or drop PostgreSQL data. Migration history and production schema must be inspected before deploying a migration that contracts existing columns.

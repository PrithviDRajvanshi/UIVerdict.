# UIVerdict — Product Requirements Document

## 1. Overview
UIVerdict is a web app that evaluates a website's UI/UX quality from a URL. It captures a screenshot and performance/accessibility data via Lighthouse, feeds it to GPT-5.5 for qualitative UI/UX critique, and returns a structured, scored report.

## 2. Goals
- Let a user paste a URL and get a UI/UX score + written critique in under ~60 seconds
- Persist evaluation history per user
- Demonstrate full-stack competency: LLM integration, REST API, relational + document data modeling, async React frontend

## 3. Non-Goals
- No manual design annotation tools
- No multi-page crawl (v1 evaluates single URL only)
- No real-time collaborative review

## 4. Users
Solo devs / designers wanting a fast, objective-ish gut check on a site's UI/UX before shipping.

## 5. Core User Flow
1. User submits a URL
2. Backend validates URL, creates evaluation record (`pending`)
3. Job triggers Lighthouse (screenshot + perf/a11y audit)
4. Screenshot + audit data sent to GPT-5.5 with a structured JSON schema prompt
5. Scores + critique saved; status → `complete`
6. Frontend polls/fetches result and renders scorecard

## 6. System Architecture
- **Frontend**: Next.js/React, Tailwind, client-side routing (`/evaluations/:id`)
- **Backend**: Node/Express (TypeScript), REST API
- **Automation**: Lighthouse for screenshot + perf/accessibility metrics
- **LLM**: GPT-5.5 via structured output (JSON schema/function calling) — no free-text parsing
- **Queue**: Redis/BullMQ for async job processing (Lighthouse + GPT calls are slow — don't block the request thread)
- **Databases**:
  - **Postgres** — `users`, `evaluations` (FK → users), `scores` (FK → evaluations) — relational, supports JOINs for history views
  - **MongoDB** — raw Lighthouse JSON + raw GPT response per evaluation, loosely keyed by `evaluation_id` — schema-flexible since LLM output shape can shift
- **Secrets**: `.env` for OpenAI key, DB URLs, Redis URL — never committed, `.env.example` checked in

## 7. API Endpoints
| Method | Endpoint | Purpose | Status codes |
|---|---|---|---|
| POST | `/api/evaluations` | Submit URL, enqueue job | 202 accepted, 422 bad URL, 429 rate limited |
| GET | `/api/evaluations/:id` | Poll status/result | 200 done, 202 processing, 404 not found |
| GET | `/api/evaluations` | List user's history (JOIN scores) | 200, 401 unauthenticated |
| DELETE | `/api/evaluations/:id` | Remove an evaluation | 204, 403 not owner |

## 8. Data Models

**Postgres**
```
users(id PK, email, created_at)
evaluations(id PK, user_id FK, url, status, created_at)
scores(id PK, evaluation_id FK, category, score, weight)
```

**MongoDB**
```
{ evaluation_id, lighthouse_raw: {...}, gpt_raw_response: {...}, created_at }
```

## 9. Middleware
- Auth check (JWT)
- Request validation (URL format, rate limit per user)
- Centralized error handler → maps thrown errors to correct HTTP status + JSON error body

## 10. Error Handling
- Invalid URL → 422 before job enqueued
- Lighthouse failure (site down/timeout) → evaluation marked `failed`, 500 on fetch with reason
- GPT API failure/timeout → 502, retry once via queue, then mark `failed`
- Rate limiting → 429 with `Retry-After` header

## 11. Frontend Notes
- `useState` for form/input state, `useEffect` for polling evaluation status
- Component composition: `<UrlForm>`, `<ScoreCard>`, `<HistoryList>` as separate composable pieces
- Async/await for all API calls, no raw `.then` chains

## 12. Engineering Practices
- Git: feature branches, PR per endpoint/component, no direct commits to `main`
- Env vars: `OPENAI_API_KEY`, `DATABASE_URL`, `MONGO_URI`, `REDIS_URL` — all in `.env`, gitignored

## 13. Milestones
1. Backend skeleton + Postgres schema + auth middleware
2. Lighthouse integration + job queue
3. GPT-5.5 structured prompt + scoring logic
4. Frontend form → scorecard flow
5. History view (Postgres JOINs) + polish

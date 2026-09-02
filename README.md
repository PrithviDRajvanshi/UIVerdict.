# UIVerdict — Automated UI/UX Website Evaluation Platform

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![React Version](https://img.shields.io/badge/react-v18.2.0-blue.svg)](https://react.dev/)
[![Express Version](https://img.shields.io/badge/express-v4.19.2-lightgrey.svg)](https://expressjs.com/)
[![Prisma Version](https://img.shields.io/badge/prisma-v7.9.1-blueviolet.svg)](https://www.prisma.io/)
[![Mongoose Version](https://img.shields.io/badge/mongoose-v9.9.2-green.svg)](https://mongoosejs.com/)
[![Gemini AI](https://img.shields.io/badge/gemini--ai-3.6--flash-orange.svg)](https://ai.google.dev/)

**UIVerdict** is a full-stack, automated UI/UX evaluation platform. Given any public website URL, UIVerdict performs a comprehensive, multi-stage forensic audit within ~60 seconds—combining headless browser screenshot capture, performance and accessibility audits, deterministic global scoring, and structured qualitative critique powered by Gemini AI.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Documentation](#api-documentation)
- [Authentication & User Data Isolation](#authentication--user-data-isolation)
- [Analysis Pipeline](#analysis-pipeline)
- [Data Architecture (Hybrid Storage)](#data-architecture-hybrid-storage)
- [Reports & Historical Archive](#reports--historical-archive)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Architecture Documentation](#architecture-documentation)

---

## Overview

Designing high-performing, accessible, and visually compelling web interfaces requires balancing quantitative performance metrics with qualitative design principles. **UIVerdict** bridges this gap by automating the website audit workflow:

1. **Automated Scanning**: Captures full-page high-resolution screenshots and executes core web performance/accessibility audits automatically.
2. **AI-Powered Design Critique**: Passes audit evidence and visual telemetry to Google Gemini AI for structured qualitative feedback (critique paragraphs, specific design strengths, and actionable areas for refinement).
3. **Hybrid Persistence**: Stores lightweight relational data (users, projects, status) in **PostgreSQL** while persisting complete audit snapshots in **MongoDB**.
4. **Interactive Dashboard & Historical Archive**: Renders comprehensive forensic scorecards and provides an authenticated evaluation archive for tracking UI/UX quality over time.

---

## Key Features

- 🌐 **Automated Full-Page Screenshot Capture**: Utilizes headless Chromium via **Playwright** to capture full-page layout evidence at desktop resolutions.
- ⚡ **Lighthouse Performance & Accessibility Audits**: Audits Core Web Vitals, including First Contentful Paint (FCP), Largest Contentful Paint (LCP), Speed Index, Total Blocking Time (TBT), and Cumulative Layout Shift (CLS).
- 🧠 **Structured Gemini AI Analysis**: Leverages Google GenAI (`gemini-3.6-flash`) with enforced JSON Schemas to deliver reliable qualitative design critiques without free-text parsing.
- 📊 **Deterministic Global Scoring**: Computes a balanced global score ($0.30 \times \text{Perf} + 0.25 \times \text{A11y} + 0.20 \times \text{BestPractices} + 0.25 \times \text{SEO}$) anchored directly to empirical audit metrics.
- 🔐 **Authentication & Session Security**: HTTP-only JWT cookie authentication with `bcryptjs` password hashing and isolated per-user evaluation archives.
- 📂 **Historical Evaluation Archive**: Multi-field search, pagination, and status filtering (Complete, Processing, Failed) across past website audits.
- 🛡️ **Fault Tolerance & Resilience**: Built-in 2-attempt Lighthouse retries, 3-attempt exponential backoff for AI service requests, and 5-minute extended server timeouts for long-running analyses.

---

## How It Works

```mermaid
flowchart TD
    User([User / Analyst]) -->|Enter URL| SPA[React SPA / Frontend]
    SPA -->|POST /api/v1/analyze| API[Express API Server]
    
    subgraph Pipeline [Analysis Orchestration Engine]
        API -->|1. Create Record| PG1[(PostgreSQL)]
        API -->|2. Capture Screenshot| PW[Playwright / Chromium]
        API -->|3. Run Audit| LH[Lighthouse Audit Engine]
        API -->|4. Generate Critique| AI[Gemini 3.6 Flash AI]
        API -->|5. Save Snapshot| MG[(MongoDB)]
        API -->|6. Mark Complete| PG2[(PostgreSQL)]
    end
    
    API -->|HTTP 200 + Payload| SPA
    SPA -->|Render Scorecard| Report[Reports Dashboard]
    SPA -->|Query History| Archive[Archive Data Log]
```

---

## System Architecture

UIVerdict follows a clean decoupled client-server architecture:

```mermaid
graph TB
    subgraph Client Layer
        Vite[Vite + React SPA]
        Router[React Router v6]
        AuthCtx[Auth Context]
    end

    subgraph Backend Application Server
        Express[Express API Gateway]
        Middleware[Auth, CORS, Helmet, Zod Middleware]
        AnalysisSvc[AnalysisService]
    end

    subgraph Automation & AI Services
        Playwright[Playwright Service]
        Lighthouse[Lighthouse Audit Service]
        Gemini[Gemini AI Service]
    end

    subgraph Data Stores
        Prisma[(PostgreSQL / Prisma ORM)]
        Mongo[(MongoDB / Mongoose ODM)]
    end

    Vite -->|HTTP / Cookies| Express
    Express --> Middleware
    Middleware --> AnalysisSvc
    AnalysisSvc --> Playwright
    AnalysisSvc --> Lighthouse
    AnalysisSvc --> Gemini
    AnalysisSvc --> Prisma
    AnalysisSvc --> Mongo
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18, Vite, TypeScript | Fast SPA rendering and state management |
| **Styling** | Tailwind CSS, Lucide Icons | Responsive modern dark-theme design system |
| **Routing** | React Router v6 | Client-side page navigation and route protection |
| **Backend API** | Node.js, Express, TypeScript | REST API gateway and request handling |
| **Database (Relational)** | PostgreSQL, Prisma ORM 7 | Relational storage for users, projects, and metadata |
| **Database (Document)** | MongoDB, Mongoose ODM 9 | Document storage for full audit snapshots |
| **Browser Automation** | Playwright (Chromium) | Headless page rendering and screenshot capture |
| **Audit Engine** | Lighthouse, Chrome Launcher | Performance, accessibility, SEO, and timing audits |
| **AI Evaluation Engine** | Google GenAI (`@google/genai`) | Qualitative UI/UX design critique with structured JSON schemas |
| **Authentication** | JWT (`jsonwebtoken`), `bcryptjs` | Secure session management with HTTP-only cookies |
| **Security** | Helmet, CORS, Zod | Security headers, cross-origin control, and schema validation |

---

## Project Structure

```
UIVerdict/
├── frontend/                 # React SPA (Vite + TypeScript + Tailwind)
│   ├── src/
│   │   ├── components/       # UI components (forms, navigation, report, history)
│   │   ├── contexts/         # Authentication and global state
│   │   ├── layouts/          # Page layout wrappers (MainLayout)
│   │   ├── pages/            # View pages (Home, Analysis, Report, History, Auth)
│   │   ├── routes/           # React Router route definitions
│   │   ├── services/         # API HTTP services (analysis, auth, history, report)
│   │   └── types/            # TypeScript interface declarations
│   ├── package.json
│   └── vite.config.ts
├── backend/                  # Express REST API Server (TypeScript)
│   ├── src/
│   │   ├── config/           # Environment, PostgreSQL, and MongoDB connections
│   │   ├── controllers/      # Route controllers (analysis, auth, archive)
│   │   ├── errors/           # Custom ApiError class and error handling
│   │   ├── middleware/       # JWT auth, Zod validation, error middleware
│   │   ├── models/           # Mongoose schemas (AnalysisSnapshot)
│   │   ├── prompts/          # Gemini AI prompt templates
│   │   ├── repositories/     # Database abstraction layer (PostgreSQL & MongoDB)
│   │   ├── routes/           # Versioned API routes (/api/v1/*)
│   │   ├── services/         # Orchestration (Playwright, Lighthouse, Gemini, Analysis)
│   │   ├── validators/       # Zod validation schemas
│   │   ├── app.ts            # Express application setup
│   │   └── server.ts         # Server bootstrap and timeout management
│   ├── prisma/
│   │   └── schema.prisma     # PostgreSQL data models (User, Project, Analysis)
│   ├── tests/                # Integration and unit test suites
│   ├── package.json
│   └── tsconfig.json
├── docs/
│   └── architecture/
│       ├── HLD.md            # High-Level System Architecture Design
│       └── LLD.md            # Low-Level Code & Implementation Design
├── package.json              # Workspace scripts
└── README.md
```

---

## Getting Started

### Prerequisites

Ensure you have the following installed on your development machine:
- **Node.js**: `v20.0.0` or higher
- **npm**: `v9.0.0` or higher
- **PostgreSQL**: `v14.0` or higher (running locally or remote connection)
- **MongoDB**: `v6.0` or higher (MongoDB Community Server or MongoDB Atlas cluster)
- **Google Gemini API Key**: Obtain a key from [Google AI Studio](https://aistudio.google.com/)

---

### Step-by-Step Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/PrithviDRajvanshi/UIVerdict..git
cd UIVerdict
```

#### 2. Install Dependencies

Install dependencies for the root workspace, backend, and frontend:

```bash
# Install backend dependencies
cd backend
npm install

# Install Playwright browser binaries
npx playwright install chromium

# Install frontend dependencies
cd ../frontend
npm install
```

#### 3. Environment Configuration

Copy the example environment configuration in the backend:

```bash
cd ../backend
cp .env.example .env
```

Update your `backend/.env` file with your actual database strings and Gemini API key:

```env
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
JWT_SECRET=your_secure_jwt_secret_key_here
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.6-flash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/uiverdict?schema=public
MONGODB_URI=mongodb://localhost:27017/uiverdict
```

#### 4. Run PostgreSQL Database Migrations

Apply the Prisma migrations to initialize your PostgreSQL database schema:

```bash
cd backend
npx prisma migrate dev --name init
npx prisma generate
```

#### 5. Start the Application

Start the backend API server and frontend development server concurrently from separate terminals:

**Terminal 1 (Backend API Server)**:
```bash
cd backend
npm run dev
```
*The backend server will launch at `http://localhost:3000`.*

**Terminal 2 (Frontend SPA)**:
```bash
cd frontend
npm run dev
```
*The frontend application will launch at `http://localhost:5173`.*

Open your browser and navigate to `http://localhost:5173`.

---

## Environment Variables

| Variable | Scope | Description | Default / Example |
|---|---|---|---|
| `PORT` | Backend | Port number for Express server | `3000` |
| `NODE_ENV` | Backend | Application environment mode | `development` |
| `FRONTEND_URL` | Backend | Allowed CORS origin(s) | `http://localhost:5173` |
| `JWT_SECRET` | Backend | Secret key used to sign session cookies | `your_secret_key` |
| `GEMINI_API_KEY` | Backend | API Key for Google GenAI | `AIzaSy...` |
| `GEMINI_MODEL` | Backend | Gemini model identifier | `gemini-3.6-flash` |
| `DATABASE_URL` | Backend | PostgreSQL connection string | `postgresql://...` |
| `MONGODB_URI` | Backend | MongoDB connection string | `mongodb://...` |
| `VITE_API_URL` | Frontend | Base backend API endpoint URL | `http://localhost:3000` |

> ⚠️ **Security Warning**: Never commit real database credentials or API keys to version control. Keep secrets strictly within gitignored `.env` files.

---

## API Documentation

### Authentication Routes (`/api/v1/auth`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | Registers a new user (`name`, `email`, `password`) | No |
| `POST` | `/api/v1/auth/login` | Authenticates user and sets HTTP-only session cookie | No |
| `POST` | `/api/v1/auth/logout` | Clears authentication session cookie | Yes |
| `GET` | `/api/v1/auth/me` | Retrieves currently authenticated user details | Yes |

### Analysis Routes (`/api/v1`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/v1/analyze` | Executes the complete 7-stage website analysis pipeline | Optional |

#### Example Request (`POST /api/v1/analyze`):
```json
{
  "url": "https://example.com"
}
```

#### Example Response (`200 OK`):
```json
{
  "status": "success",
  "message": "Analysis completed successfully",
  "data": {
    "url": "https://example.com",
    "screenshot": {
      "filename": "20260902-101500-example-com-a1b2c3.png",
      "path": "temp/screenshots/20260902-101500-example-com-a1b2c3.png"
    },
    "metrics": {
      "performance": 92,
      "accessibility": 88,
      "bestPractices": 95,
      "seo": 90,
      "firstContentfulPaint": "1.2 s",
      "largestContentfulPaint": "2.1 s",
      "speedIndex": "1.5 s",
      "totalBlockingTime": "40 ms",
      "cumulativeLayoutShift": "0.01",
      "timeToInteractive": "2.2 s"
    },
    "aiAnalysis": {
      "overallVerdict": {
        "score": 91.3,
        "label": "EXCELLENT"
      },
      "qualitativeCritique": [
        "The website displays exemplary layout symmetry and responsive grid scaling..."
      ],
      "strengths": [
        "Exceptional typographic hierarchy and contrast ratio",
        "Fast initial DOM content loading with minimal layout shift"
      ],
      "areasForRefinement": [
        "Consider lazy loading below-the-fold media elements"
      ]
    }
  }
}
```

### Archive Routes (`/api/v1`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/v1/analyses` | Fetches historical evaluation records with pagination and status filters | Yes |

**Query Parameters**:
- `page` (default: `1`)
- `limit` (default: `10`)
- `status` (`ALL`, `COMPLETE`, `PENDING`, `FAILED`)
- `search` (Search by Analysis ID or URL)

---

## Authentication & User Data Isolation

UIVerdict implements secure user authentication and data isolation:

1. **Password Hashing**: User passwords are encrypted using `bcryptjs` with standard salt rounds before storage.
2. **HTTP-Only Cookies**: Authentication tokens are issued as HTTP-only `SameSite=Lax` cookies, shielding them from client-side XSS attacks.
3. **Data Isolation**: Analyses created while logged in are linked to the authenticated `User.id` in PostgreSQL. When fetching `/api/v1/analyses`, the query enforces `where: { userId: req.user.id }`, guaranteeing users can only view their own evaluations.

---

## Analysis Pipeline

When a URL is submitted, `AnalysisService.analyzeUrl()` executes the following sequential pipeline:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Controller as Analysis Controller
    participant Service as AnalysisService
    participant PG as PostgreSQL (Prisma)
    participant PW as Playwright
    participant LH as Lighthouse
    participant AI as Gemini AI
    participant MG as MongoDB (Mongoose)

    User->>Controller: POST /api/v1/analyze { url }
    Controller->>Service: analyzeUrl(url, userId)
    Service->>PG: Create Transaction (Project + Analysis [PROCESSING])
    Service->>PW: captureScreenshot(url)
    PW-->>Service: Return screenshot path & filename
    Service->>LH: runAudit(url)
    LH-->>Service: Return Lighthouse metrics (FCP, LCP, A11y, etc.)
    Service->>Service: Calculate globalScore (Weighted formula)
    Service->>AI: generateAnalysis(metrics, screenshot, globalScore)
    AI-->>Service: Return structured JSON (Critique, Strengths, Refinements)
    Service->>MG: saveSnapshot(analysisId, metrics, aiAnalysis, screenshot)
    MG-->>Service: Return mongoSnapshot._id
    Service->>PG: updateAnalysisStatus(analysisId, COMPLETED, mongoDocumentId)
    Service-->>Controller: Return AnalysisResponse JSON
    Controller-->>User: HTTP 200 OK Response
```

---

## Data Architecture (Hybrid Storage)

UIVerdict employs a hybrid dual-database strategy tailored to access patterns:

```mermaid
erDiagram
    USER ||--o{ PROJECT : owns
    USER ||--o{ ANALYSIS : creates
    PROJECT ||--o{ ANALYSIS : contains
    ANALYSIS ||--|| ANALYSIS_SNAPSHOT : references

    USER {
        string id PK
        string email UK
        string name
        string passwordHash
        datetime createdAt
    }

    PROJECT {
        string id PK
        string userId FK
        string name
    }

    ANALYSIS {
        string id PK
        string projectId FK
        string userId FK
        string url
        enum status
        string mongoDocumentId
        datetime createdAt
    }

    ANALYSIS_SNAPSHOT {
        string id PK
        string analysisId UK
        string url
        json screenshot
        json metrics
        json aiAnalysis
        datetime createdAt
    }
```

- **PostgreSQL (Relational Metadata)**: Handles core relational entities (`User`, `Project`, `Analysis`), enforcing relational integrity, foreign key constraints, fast indexed filtering, and user ownership logic.
- **MongoDB (Unstructured Audit Snapshots)**: Stores full high-fidelity audit documents (`AnalysisSnapshot`), allowing flexible snapshot payload structures without requiring rigid SQL table migrations.

---

## Reports & Historical Archive

- **Interactive Report**: Once an analysis resolves, the application displays a detailed forensic scorecard containing category progress bars, Lighthouse Web Vitals, qualitative critique, strengths, and actionable refinements.
- **Data Log Archive**: The Archive page lists all past evaluations for the authenticated user, supported by server-side pagination, search filtering, and raw JSON export functionality.

---

## Testing

Backend unit and integration tests are powered by `ts-node`:

```bash
cd backend
npm test
```

### Test Suite Coverage:
- `tests/auth.service.test.ts`: User registration, duplicate email rejection, bcrypt hashing, authentication, and archive isolation.
- `tests/gemini.service.test.ts`: Gemini API model response generation and Zod schema validation.
- `tests/persistence.service.test.ts`: Prisma PostgreSQL transaction flows and Mongoose MongoDB document persistence.
- `tests/multi_site_verify.test.ts`: End-to-end multi-site URL analysis verification.

---

## Troubleshooting

### 1. PostgreSQL Connection Error
- Ensure PostgreSQL is running on port `5432`.
- Verify `DATABASE_URL` in `backend/.env`.
- Test connection using `npx prisma db push`.

### 2. MongoDB Connection Error
- Ensure MongoDB is running on port `27017` or verify your MongoDB Atlas cluster URI.
- Verify `MONGODB_URI` in `backend/.env`.

### 3. Playwright / Chromium Launch Failure
- Run `npx playwright install chromium` in the `backend/` directory to download required browser binaries.

### 4. Gemini API Key Error
- Ensure `GEMINI_API_KEY` is specified in `backend/.env`.
- Verify your API key has active quota in Google AI Studio.

---

## Architecture Documentation

For in-depth architectural and code-level design documentation, refer to:
- 📄 [High-Level Design (HLD)](file:///d:/UIverdict/docs/architecture/HLD.md)
- 📄 [Low-Level Design (LLD)](file:///d:/UIverdict/docs/architecture/LLD.md)

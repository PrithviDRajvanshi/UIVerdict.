# PostgreSQL + Prisma Database Architecture

This document outlines the unified database architecture implemented for the UIVerdict backend service. The persistence layer leverages **PostgreSQL** as the single source of truth via **Prisma ORM**.

---

## 1. Architecture Overview

- **PostgreSQL (via Prisma ORM)** serves as the single source of truth for all application entities:
  - User accounts and authentication credentials (`User`)
  - Project hierarchy (`Project`)
  - Analysis execution state, stable scalar metrics (Lighthouse performance/A11y/Best Practices/SEO, Core Web Vitals, overall UIVerdict score, verdict label), and structured AI analysis qualitative critiques/strengths/refinements (`Analysis`).

### Why PostgreSQL as the Single Source of Truth?
- **Unified ACID Transactions**: Atomic execution lifecycle management without dual-store synchronization anomalies.
- **Simplified Operations**: A single database engine reduces deployment complexity, connection pools, and failure modes.
- **Native Relational Queries & Aggregations**: Relational columns for stable scalar metrics enable high-speed SQL indexing, filtering, and aggregation.
- **Native JSONB Support**: Rich, variable structured outputs from Gemini AI (`qualitativeCritique`, `strengths`, `areasForRefinement`) are stored cleanly in PostgreSQL `Json` columns without loss of flexibility.

---

## 2. PostgreSQL Relational Schema (`prisma/schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client-js"
}

enum AnalysisStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

model User {
  id           String     @id @default(uuid())
  name         String
  email        String     @unique
  passwordHash String
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  projects     Project[]
  analyses     Analysis[]

  @@map("users")
}

model Project {
  id        String     @id @default(uuid())
  userId    String?
  user      User?      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String     @default("Default Project")
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  analyses  Analysis[]

  @@index([userId])
  @@map("projects")
}

model Analysis {
  id                     String         @id @default(uuid())
  projectId              String
  project                Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  userId                 String?
  user                   User?          @relation(fields: [userId], references: [id], onDelete: Cascade)
  url                    String
  status                 AnalysisStatus @default(PENDING)

  // Overall UIVerdict scoring
  overallScore           Float?
  verdictLabel           String?

  // Lighthouse score scalars (0-100)
  performanceScore       Int?
  accessibilityScore     Int?
  bestPracticesScore     Int?
  seoScore               Int?

  // Core Web Vitals & diagnostic display metrics
  firstContentfulPaint   String?
  largestContentfulPaint String?
  speedIndex             String?
  totalBlockingTime      String?
  cumulativeLayoutShift  String?
  timeToInteractive      String?

  // Variable & structured AI analysis data (stored as JSON)
  qualitativeCritique    Json?
  strengths              Json?
  areasForRefinement     Json?

  createdAt              DateTime       @default(now())
  updatedAt              DateTime       @updatedAt

  @@index([projectId])
  @@index([userId])
  @@index([url])
  @@index([status])
  @@index([overallScore])
  @@index([createdAt])
  @@map("analyses")
}
```

---

## 3. Analysis Pipeline & Persistence Workflow

The analysis execution flow operates as follows:

```
Create PostgreSQL analysis record (PROCESSING)
        ↓
Capture Playwright screenshot
        ↓
Execute Lighthouse audit
        ↓
Generate Gemini AI analysis
        ↓
Persist complete analysis result to PostgreSQL
        ↓
Mark analysis status COMPLETED
        ↓
Return AnalysisResponse
```

### Failure Handling Strategy:
If Playwright, Lighthouse, or Gemini encounters an unrecoverable failure:
- PostgreSQL `Analysis` status is updated to `FAILED`.
- Error is returned cleanly without leaving orphaned records across secondary stores.

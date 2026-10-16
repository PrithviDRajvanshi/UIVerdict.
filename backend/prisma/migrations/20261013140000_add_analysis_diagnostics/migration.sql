ALTER TABLE "analyses"
  ADD COLUMN "playwrightDiagnostics" JSONB,
  ADD COLUMN "lighthouseDiagnostics" JSONB,
  ADD COLUMN "screenshotArtifactName" VARCHAR(200),
  ADD COLUMN "screenshotSha256" CHAR(64);

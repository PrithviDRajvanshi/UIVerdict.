-- Corrective migration: the preceding migration may already be applied in some environments.
-- Keep this as a new migration rather than rewriting historical migration SQL.
ALTER TABLE "analyses"
  DROP COLUMN IF EXISTS "screenshotUrl",
  DROP COLUMN IF EXISTS "screenshotFilename",
  DROP COLUMN IF EXISTS "screenshotPath",
  DROP COLUMN IF EXISTS "rawMetrics";

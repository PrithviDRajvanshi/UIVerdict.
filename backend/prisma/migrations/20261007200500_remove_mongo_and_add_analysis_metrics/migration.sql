-- AlterTable
ALTER TABLE "analyses" DROP COLUMN "mongoDocumentId",
ADD COLUMN     "accessibilityScore" INTEGER,
ADD COLUMN     "areasForRefinement" JSONB,
ADD COLUMN     "bestPracticesScore" INTEGER,
ADD COLUMN     "cumulativeLayoutShift" TEXT,
ADD COLUMN     "firstContentfulPaint" TEXT,
ADD COLUMN     "largestContentfulPaint" TEXT,
ADD COLUMN     "overallScore" DOUBLE PRECISION,
ADD COLUMN     "performanceScore" INTEGER,
ADD COLUMN     "qualitativeCritique" JSONB,
ADD COLUMN     "rawMetrics" JSONB,
ADD COLUMN     "screenshotFilename" TEXT,
ADD COLUMN     "screenshotPath" TEXT,
ADD COLUMN     "screenshotUrl" TEXT,
ADD COLUMN     "seoScore" INTEGER,
ADD COLUMN     "speedIndex" TEXT,
ADD COLUMN     "strengths" JSONB,
ADD COLUMN     "timeToInteractive" TEXT,
ADD COLUMN     "totalBlockingTime" TEXT,
ADD COLUMN     "verdictLabel" TEXT;

-- CreateIndex
CREATE INDEX "analyses_overallScore_idx" ON "analyses"("overallScore");

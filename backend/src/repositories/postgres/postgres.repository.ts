import { prisma } from '../../config/postgres';
import { Analysis, AnalysisStatus, Project, Prisma } from '@prisma/client';
import { LighthouseMetrics } from '../../services/lighthouse.service';
import { AiAnalysis, VerdictLabel } from '../../validators/aiAnalysis.validator';
import { sanitizeLighthouseDiagnostics, sanitizePlaywrightDiagnostics } from '../../services/browser-diagnostics';
import { ApiError } from '../../errors/ApiError';
import { calculateOverallScore } from '../../services/scoring.service';
import { resolveVerdictLabel } from '../../validators/aiAnalysis.validator';

export interface SaveAnalysisResultInput {
  metrics: LighthouseMetrics;
  aiAnalysis?: AiAnalysis;
  overallScore?: number | null;
  status?: AnalysisStatus;
  screenshotArtifactName?: string;
  screenshotSha256?: string;
}

export interface SavedAnalysisReport {
  id: string;
  url: string;
  mode: 'visual' | 'tech' | 'overall' | 'unknown';
  metrics: LighthouseMetrics;
  aiStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_REQUESTED';
  aiAnalysis: {
    visualDesignScore: number | null;
    overallVerdict: { score: number; label: VerdictLabel } | null;
    qualitativeCritique: string[];
    strengths: string[];
    areasForRefinement: string[];
  } | null;
  status: AnalysisStatus;
  visualDesignScore: number | null;
  validationReason: string | null;
  overallScore: number | null;
  verdictLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function reportMode(analysis: Analysis): SavedAnalysisReport['mode'] {
  const visual = analysis.visualDesignScore !== null;
  const technical = [analysis.performanceScore, analysis.accessibilityScore, analysis.bestPracticesScore, analysis.seoScore]
    .some((score) => score !== null) || [analysis.firstContentfulPaint, analysis.largestContentfulPaint,
      analysis.speedIndex, analysis.totalBlockingTime, analysis.cumulativeLayoutShift, analysis.timeToInteractive]
      .some((metric) => metric !== null && metric.trim() !== '' && metric.toLowerCase() !== 'n/a');
  if (visual && technical) return 'overall';
  if (visual) return 'visual';
  if (technical) return 'tech';
  if (analysis.overallScore !== null) return 'overall';
  return 'unknown';
}

function reportAiStatus(analysis: Analysis): SavedAnalysisReport['aiStatus'] {
  if (analysis.visualDesignScore !== null || analysis.overallScore !== null) return 'AVAILABLE';
  if (reportMode(analysis) === 'tech') return 'NOT_REQUESTED';
  return 'UNAVAILABLE';
}

export interface UrlAggregateStats {
  url: string;
  totalAnalyses: number;
  avgPerformance: number;
  avgAccessibility: number;
  avgBestPractices: number;
  avgSeo: number;
  avgOverallScore: number;
  latestAnalysisAt: Date;
}

export class PostgresRepository {
  /**
   * Executes a Prisma transaction to resolve/create a Project and create an Analysis record.
   */
  public async createAnalysisTransaction(
    url: string,
    projectName = 'Default Project',
    userId?: string
  ): Promise<{ project: Project; analysis: Analysis }> {
    return await prisma.$transaction(async (tx) => {
      if (userId) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) throw new ApiError(401, 'Invalid or expired authentication session.');
      }

      let project = await tx.project.findFirst({
        where: {
          name: projectName,
          userId: userId ?? null,
        },
      });

      if (!project) {
        project = await tx.project.create({
          data: {
            name: projectName,
            ...(userId ? { userId } : {}),
          },
        });
      }

      const analysis = await tx.analysis.create({
        data: {
          projectId: project.id,
          url,
          status: AnalysisStatus.PROCESSING,
          ...(userId ? { userId } : {}),
        },
      });

      return { project, analysis };
    });
  }

  /**
   * Updates an Analysis record status.
   */
  public async updateAnalysisStatus(
    analysisId: string,
    status: AnalysisStatus
  ): Promise<Analysis> {
    return await prisma.analysis.update({
      where: { id: analysisId },
      data: {
        status,
      },
    });
  }

  public async updatePlaywrightDiagnostics(analysisId: string, diagnostics: unknown): Promise<Analysis> {
    const safeDiagnostics = sanitizePlaywrightDiagnostics(diagnostics);
    return prisma.analysis.update({
      where: { id: analysisId },
      data: { playwrightDiagnostics: safeDiagnostics as unknown as Prisma.InputJsonValue },
    });
  }

  public async updateLighthouseDiagnostics(analysisId: string, diagnostics: unknown): Promise<Analysis> {
    const safeDiagnostics = sanitizeLighthouseDiagnostics(diagnostics);
    return prisma.analysis.update({
      where: { id: analysisId },
      data: { lighthouseDiagnostics: safeDiagnostics as unknown as Prisma.InputJsonValue },
    });
  }

  public async updateScreenshotIdentity(analysisId: string, artifactName: string, sha256: string): Promise<Analysis> {
    const safeName = artifactName.slice(0, 200);
    if (!safeName.startsWith('uiverdict-') || safeName !== safeName.split(/[\\/]/).pop() || !/^[a-f0-9]{64}$/i.test(sha256)) {
      throw new Error('Invalid temporary screenshot identity metadata');
    }
    return prisma.analysis.update({
      where: { id: analysisId },
      data: { screenshotArtifactName: safeName, screenshotSha256: sha256.toLowerCase() },
    });
  }

  /**
   * Persists the complete audit result (Lighthouse metrics and Gemini AI analysis)
   * to PostgreSQL in a single atomic update operation and marks status as COMPLETED.
   */
  public async saveAnalysisResult(
    analysisId: string,
    input: SaveAnalysisResultInput
  ): Promise<Analysis> {
    const overallScore = input.overallScore !== undefined ? input.overallScore : input.aiAnalysis
      ? calculateOverallScore(input.aiAnalysis.visualDesignScore, input.metrics)
      : null;
    return await prisma.analysis.update({
      where: { id: analysisId },
      data: {
        status: input.status ?? AnalysisStatus.COMPLETED,
        // Overall UIVerdict scoring
        ...(input.aiAnalysis ? {
          visualDesignScore: input.aiAnalysis.visualDesignScore,
          overallScore,
          verdictLabel: overallScore === null ? null : resolveVerdictLabel(overallScore),
          qualitativeCritique: input.aiAnalysis.qualitativeCritique,
          strengths: input.aiAnalysis.strengths,
          areasForRefinement: input.aiAnalysis.areasForRefinement,
        } : {}),
        // Lighthouse metric scalars
        performanceScore: input.metrics.performance,
        accessibilityScore: input.metrics.accessibility,
        bestPracticesScore: input.metrics.bestPractices,
        seoScore: input.metrics.seo,
        firstContentfulPaint: input.metrics.firstContentfulPaint,
        largestContentfulPaint: input.metrics.largestContentfulPaint,
        speedIndex: input.metrics.speedIndex,
        totalBlockingTime: input.metrics.totalBlockingTime,
        cumulativeLayoutShift: input.metrics.cumulativeLayoutShift,
        timeToInteractive: input.metrics.timeToInteractive,
        ...(input.screenshotArtifactName ? { screenshotArtifactName: input.screenshotArtifactName.slice(0, 200) } : {}),
        ...(input.screenshotSha256 && /^[a-f0-9]{64}$/i.test(input.screenshotSha256)
          ? { screenshotSha256: input.screenshotSha256.toLowerCase() }
          : {}),
      },
    });
  }

  public async getCompletedReport(
    analysisId: string,
    access: { userId: string } | { guest: true }
  ): Promise<SavedAnalysisReport | null> {
    const analysis = await prisma.analysis.findFirst({
      where: {
        id: analysisId,
        status: { in: [AnalysisStatus.COMPLETED, AnalysisStatus.BLOCKED, AnalysisStatus.INCONCLUSIVE] },
        ...('userId' in access ? { userId: access.userId } : { userId: null }),
      },
    });
    if (!analysis) return null;

    return {
      id: analysis.id,
      url: analysis.url,
      mode: reportMode(analysis),
      status: analysis.status,
      visualDesignScore: analysis.visualDesignScore,
      validationReason: typeof analysis.playwrightDiagnostics === 'object' && analysis.playwrightDiagnostics !== null && 'validationReason' in analysis.playwrightDiagnostics
        ? String((analysis.playwrightDiagnostics as any).validationReason ?? '') || null : null,
      overallScore: analysis.overallScore,
      verdictLabel: analysis.verdictLabel,
      metrics: {
        performance: analysis.performanceScore,
        accessibility: analysis.accessibilityScore,
        bestPractices: analysis.bestPracticesScore,
        seo: analysis.seoScore,
        firstContentfulPaint: analysis.firstContentfulPaint ?? '',
        largestContentfulPaint: analysis.largestContentfulPaint ?? '',
        speedIndex: analysis.speedIndex ?? '',
        totalBlockingTime: analysis.totalBlockingTime ?? '',
        cumulativeLayoutShift: analysis.cumulativeLayoutShift ?? '',
        timeToInteractive: analysis.timeToInteractive ?? '',
      },
      aiStatus: reportAiStatus(analysis),
      aiAnalysis: analysis.visualDesignScore === null && analysis.overallScore === null ? null : {
        visualDesignScore: analysis.visualDesignScore,
        overallVerdict: analysis.overallScore === null ? null : { score: analysis.overallScore, label: (analysis.verdictLabel ?? '') as VerdictLabel },
        qualitativeCritique: (analysis.qualitativeCritique as string[]) ?? [],
        strengths: (analysis.strengths as string[]) ?? [],
        areasForRefinement: (analysis.areasForRefinement as string[]) ?? [],
      },
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
    };
  }

  /**
   * Retrieves an Analysis record by ID.
   */
  public async findAnalysisById(analysisId: string): Promise<Analysis | null> {
    return await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { project: true },
    });
  }

  /**
   * Formats an Analysis record from PostgreSQL into the snapshot structure.
   */
  public formatAnalysisToSnapshot(analysis: Analysis): SavedAnalysisReport | null {
    const hasSectionScore = analysis.visualDesignScore !== null || [
      analysis.performanceScore,
      analysis.accessibilityScore,
      analysis.bestPracticesScore,
      analysis.seoScore,
    ].some((score) => score !== null);
    const hasTechnicalMetric = [analysis.firstContentfulPaint, analysis.largestContentfulPaint, analysis.speedIndex,
      analysis.totalBlockingTime, analysis.cumulativeLayoutShift, analysis.timeToInteractive]
      .some((metric) => metric !== null && metric.trim() !== '' && metric.toLowerCase() !== 'n/a');
    if (!hasSectionScore && !hasTechnicalMetric && analysis.overallScore === null) {
      return null;
    }

    return {
      id: analysis.id,
      url: analysis.url,
      mode: reportMode(analysis),
      status: analysis.status,
      visualDesignScore: analysis.visualDesignScore,
      validationReason: typeof analysis.playwrightDiagnostics === 'object' && analysis.playwrightDiagnostics !== null && 'validationReason' in analysis.playwrightDiagnostics
        ? String((analysis.playwrightDiagnostics as any).validationReason ?? '') || null : null,
      overallScore: analysis.overallScore,
      verdictLabel: analysis.verdictLabel,
      metrics: {
        performance: analysis.performanceScore,
        accessibility: analysis.accessibilityScore,
        bestPractices: analysis.bestPracticesScore,
        seo: analysis.seoScore,
        firstContentfulPaint: analysis.firstContentfulPaint ?? '',
        largestContentfulPaint: analysis.largestContentfulPaint ?? '',
        speedIndex: analysis.speedIndex ?? '',
        totalBlockingTime: analysis.totalBlockingTime ?? '',
        cumulativeLayoutShift: analysis.cumulativeLayoutShift ?? '',
        timeToInteractive: analysis.timeToInteractive ?? '',
      },
      aiStatus: reportAiStatus(analysis),
      aiAnalysis: analysis.visualDesignScore === null && analysis.overallScore === null ? null : {
        visualDesignScore: analysis.visualDesignScore,
        overallVerdict: analysis.overallScore === null ? null : { score: analysis.overallScore, label: (analysis.verdictLabel ?? '') as VerdictLabel },
        qualitativeCritique: (analysis.qualitativeCritique as string[]) || [],
        strengths: (analysis.strengths as string[]) || [],
        areasForRefinement: (analysis.areasForRefinement as string[]) || [],
      },
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
    };
  }

  /**
   * Retrieves snapshot data for an analysis by its ID.
   */
  public async getSnapshotByAnalysisId(analysisId: string): Promise<SavedAnalysisReport | null> {
    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
    });
    if (!analysis) return null;
    return this.formatAnalysisToSnapshot(analysis);
  }

  /**
   * Retrieves history of snapshots for a target URL sorted by creation time descending.
   */
  public async getSnapshotsByUrl(url: string, limit = 10): Promise<SavedAnalysisReport[]> {
    const records = await prisma.analysis.findMany({
      where: {
        url,
        status: AnalysisStatus.COMPLETED,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return records
      .map((r) => this.formatAnalysisToSnapshot(r))
      .filter((s): s is SavedAnalysisReport => s !== null);
  }

  /**
   * Computes aggregate URL analysis statistics using PostgreSQL via Prisma.
   */
  public async getAnalysisStatsByUrl(url?: string): Promise<UrlAggregateStats[]> {
    const where = {
      status: AnalysisStatus.COMPLETED,
      overallScore: { not: null },
      ...(url ? { url } : {}),
    };

    const stats = await prisma.analysis.groupBy({
      by: ['url'],
      where,
      _count: {
        _all: true,
      },
      _avg: {
        performanceScore: true,
        accessibilityScore: true,
        bestPracticesScore: true,
        seoScore: true,
        overallScore: true,
      },
      _max: {
        createdAt: true,
      },
    });

    return stats.map((s) => ({
      url: s.url,
      totalAnalyses: s._count._all,
      avgPerformance: Math.round(((s._avg.performanceScore ?? 0)) * 10) / 10,
      avgAccessibility: Math.round(((s._avg.accessibilityScore ?? 0)) * 10) / 10,
      avgBestPractices: Math.round(((s._avg.bestPracticesScore ?? 0)) * 10) / 10,
      avgSeo: Math.round(((s._avg.seoScore ?? 0)) * 10) / 10,
      avgOverallScore: Math.round(((s._avg.overallScore ?? 0)) * 10) / 10,
      latestAnalysisAt: s._max.createdAt || new Date(),
    }));
  }

  /**
   * Retrieves all Analysis records for a given Project.
   */
  public async findAnalysesByProject(projectId: string): Promise<Analysis[]> {
    return await prisma.analysis.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const postgresRepository = new PostgresRepository();

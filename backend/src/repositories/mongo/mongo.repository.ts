import { AnalysisSnapshotModel, IAnalysisSnapshot } from '../../models/mongo/snapshot.model';
import { ScreenshotResult } from '../../services/playwright.service';
import { LighthouseMetrics } from '../../services/lighthouse.service';
import { AiAnalysis } from '../../validators/aiAnalysis.validator';

export interface CreateSnapshotInput {
  analysisId: string;
  url: string;
  screenshot: ScreenshotResult;
  metrics: LighthouseMetrics;
  aiAnalysis: AiAnalysis;
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

export class MongoRepository {
  /**
   * Persists an AnalysisSnapshot document in MongoDB.
   */
  public async saveSnapshot(input: CreateSnapshotInput): Promise<IAnalysisSnapshot> {
    const snapshot = new AnalysisSnapshotModel({
      analysisId: input.analysisId,
      url: input.url,
      screenshot: input.screenshot,
      metrics: input.metrics,
      aiAnalysis: input.aiAnalysis,
    });
    return await snapshot.save();
  }

  /**
   * Retrieves a snapshot document by its cross-database reference analysisId.
   */
  public async getSnapshotByAnalysisId(analysisId: string): Promise<IAnalysisSnapshot | null> {
    return await AnalysisSnapshotModel.findOne({ analysisId }).exec();
  }

  /**
   * Retrieves history of snapshots for a target URL sorted by creation time descending.
   */
  public async getSnapshotsByUrl(url: string, limit = 10): Promise<IAnalysisSnapshot[]> {
    return await AnalysisSnapshotModel.find({ url })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Executes a real MongoDB aggregation pipeline to compute URL analysis metrics statistics.
   */
  public async getAnalysisStatsByUrl(url?: string): Promise<UrlAggregateStats[]> {
    const matchStage = url ? { $match: { url } } : { $match: {} };

    const pipeline: any[] = [
      matchStage,
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$url',
          totalAnalyses: { $sum: 1 },
          avgPerformance: { $avg: '$metrics.performance' },
          avgAccessibility: { $avg: '$metrics.accessibility' },
          avgBestPractices: { $avg: '$metrics.bestPractices' },
          avgSeo: { $avg: '$metrics.seo' },
          avgOverallScore: { $avg: '$aiAnalysis.overallVerdict.score' },
          latestAnalysisAt: { $max: '$createdAt' },
        },
      },
      {
        $project: {
          _id: 0,
          url: '$_id',
          totalAnalyses: 1,
          avgPerformance: { $round: ['$avgPerformance', 1] },
          avgAccessibility: { $round: ['$avgAccessibility', 1] },
          avgBestPractices: { $round: ['$avgBestPractices', 1] },
          avgSeo: { $round: ['$avgSeo', 1] },
          avgOverallScore: { $round: ['$avgOverallScore', 1] },
          latestAnalysisAt: 1,
        },
      },
    ];

    return await AnalysisSnapshotModel.aggregate(pipeline).exec();
  }
}

export const mongoRepository = new MongoRepository();

import { Schema, model, Document } from 'mongoose';
import { ScreenshotResult } from '../../services/playwright.service';
import { LighthouseMetrics } from '../../services/lighthouse.service';
import { AiAnalysis } from '../../validators/aiAnalysis.validator';

export interface IAnalysisSnapshot extends Document {
  analysisId: string;
  url: string;
  screenshot: ScreenshotResult;
  metrics: LighthouseMetrics;
  aiAnalysis: AiAnalysis;
  createdAt: Date;
  updatedAt: Date;
}

const AnalysisSnapshotSchema = new Schema<IAnalysisSnapshot>(
  {
    analysisId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
      index: true,
    },
    screenshot: {
      url: { type: String, required: true },
      filename: { type: String, required: true },
      path: { type: String, required: true },
    },
    metrics: {
      performance: { type: Number, required: true },
      accessibility: { type: Number, required: true },
      bestPractices: { type: Number, required: true },
      seo: { type: Number, required: true },
      firstContentfulPaint: { type: String, required: true },
      largestContentfulPaint: { type: String, required: true },
      speedIndex: { type: String, required: true },
      totalBlockingTime: { type: String, required: true },
      cumulativeLayoutShift: { type: String, required: true },
      timeToInteractive: { type: String, required: true },
    },
    aiAnalysis: {
      overallVerdict: {
        score: { type: Number, required: true },
        label: { type: String, required: true },
      },
      qualitativeCritique: [{ type: String, required: true }],
      strengths: [{ type: String, required: true }],
      areasForRefinement: [{ type: String, required: true }],
    },
  },
  {
    timestamps: true,
  }
);

AnalysisSnapshotSchema.index({ url: 1, createdAt: -1 });

export const AnalysisSnapshotModel = model<IAnalysisSnapshot>(
  'AnalysisSnapshot',
  AnalysisSnapshotSchema
);

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
}

export interface Config {
  port: number;
  nodeEnv: string;
  geminiApiKey?: string;
  geminiModel: string;
  geminiFallbackModel: string;
  geminiLastFallbackModel: string;
  geminiTimeoutMs: number;
  geminiDeadlineMs: number;
  geminiMaxAttempts: number;
  databaseUrl: string;
  jwtSecret: string;
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  geminiFallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash',
  geminiLastFallbackModel: process.env.GEMINI_LAST_FALLBACK_MODEL || 'gemini-3.5-flash-lite',
  geminiTimeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS || '25000', 10),
  geminiDeadlineMs: parseInt(process.env.GEMINI_DEADLINE_MS || '45000', 10),
  geminiMaxAttempts: parseInt(process.env.GEMINI_MAX_ATTEMPTS || '2', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/uiverdict?schema=public',
  jwtSecret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'uiverdict-secret-jwt-key'),
};

if (config.nodeEnv === 'production' && !config.jwtSecret) {
  throw new Error('JWT_SECRET must be configured in production');
}

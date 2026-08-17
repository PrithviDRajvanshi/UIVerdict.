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
  databaseUrl: string;
  mongodbUri: string;
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/uiverdict?schema=public',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/uiverdict',
};


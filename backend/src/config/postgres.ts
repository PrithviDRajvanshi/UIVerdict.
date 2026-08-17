import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from './env';

const pool = new Pool({ connectionString: config.databaseUrl });
const adapter = new PrismaPg(pool);

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma =
  globalThis.prismaGlobal ||
  new PrismaClient({
    adapter,
    log: config.nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (config.nodeEnv !== 'production') {
  globalThis.prismaGlobal = prisma;
}

export async function connectPostgres(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('✅ PostgreSQL connected via Prisma');
  } catch (error: any) {
    console.error('⚠️ PostgreSQL connection failed:', error?.message || error);
  }
}

export async function disconnectPostgres(): Promise<void> {
  try {
    await prisma.$disconnect();
    await pool.end();
    console.log('PostgreSQL disconnected');
  } catch (error: any) {
    console.error('Error disconnecting PostgreSQL:', error?.message || error);
  }
}


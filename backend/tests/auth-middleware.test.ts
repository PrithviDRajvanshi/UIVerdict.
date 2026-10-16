import assert from 'assert';
import jwt from 'jsonwebtoken';
import { authMiddleware, optionalAuthMiddleware } from '../src/middleware/auth.middleware';
import { prisma } from '../src/config/postgres';
import { config } from '../src/config/env';
import { postgresRepository } from '../src/repositories/postgres/postgres.repository';

function invoke(middleware: typeof authMiddleware, req: any): Promise<{ user?: unknown; error?: any; clearedCookies: string[] }> {
  return new Promise((resolve) => {
    const clearedCookies: string[] = [];
    const response: any = { clearCookie: (name: string) => clearedCookies.push(name) };
    middleware(req, response, (error?: unknown) => resolve({ user: req.user, error, clearedCookies }));
  });
}

async function run() {
  const originalFindUnique = prisma.user.findUnique;
  const originalTransaction = prisma.$transaction;
  try {
    const user = { id: 'database-user-id', name: 'Database User', email: 'db@example.test' };
    (prisma.user as any).findUnique = async ({ where }: any) => where.id === user.id ? user : null;

    const guest = await invoke(optionalAuthMiddleware, { cookies: {}, headers: {} });
    assert.strictEqual(guest.error, undefined, 'missing optional credentials should remain a guest request');
    assert.strictEqual(guest.user, undefined);

    const token = jwt.sign({ id: user.id, name: 'stale claim', email: 'stale@example.test' }, config.jwtSecret);
    const authenticated = await invoke(optionalAuthMiddleware, { cookies: { token }, headers: {} });
    assert.strictEqual(authenticated.error, undefined);
    assert.deepStrictEqual(authenticated.user, user, 'request identity must come from the current database row');

    const deletedUserToken = jwt.sign({ id: 'deleted-user-id' }, config.jwtSecret);
    const stale = await invoke(optionalAuthMiddleware, { cookies: { token: deletedUserToken }, headers: {} });
    assert.strictEqual(stale.error?.statusCode, 401, 'a valid JWT for a deleted user must not reach analysis creation');
    assert.deepStrictEqual(stale.clearedCookies, ['token'], 'a stale HttpOnly session cookie must be cleared');

    const invalid = await invoke(optionalAuthMiddleware, { cookies: { token: 'invalid-token' }, headers: {} });
    assert.strictEqual(invalid.error?.statusCode, 401, 'invalid credentials must not silently become a guest request');
    assert.deepStrictEqual(invalid.clearedCookies, ['token']);

    const requiredGuest = await invoke(authMiddleware, { cookies: {}, headers: {} });
    assert.strictEqual(requiredGuest.error?.statusCode, 401, 'required authentication must reject guests');

    let projectLookup: any;
    let guestProjectData: any;
    let guestAnalysisData: any;
    (prisma as any).$transaction = async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { findUnique: async () => null },
      project: {
        findFirst: async (args: any) => { projectLookup = args; return null; },
        create: async ({ data }: any) => { guestProjectData = data; return { id: 'unowned-project' }; },
      },
      analysis: {
        create: async ({ data }: any) => { guestAnalysisData = data; return { id: 'guest-analysis' }; },
      },
    });
    await assert.rejects(
      postgresRepository.createAnalysisTransaction('https://example.com/', 'Default Project', 'deleted-user-id'),
      (error: any) => error.statusCode === 401,
      'analysis creation must reject an owner ID that is missing from PostgreSQL',
    );

    const guestCreation = await postgresRepository.createAnalysisTransaction('https://example.com/', 'Default Project');
    assert.deepStrictEqual(projectLookup.where, { name: 'Default Project', userId: null }, 'guest lookup must never select a user-owned project');
    assert.ok(!Object.prototype.hasOwnProperty.call(guestProjectData, 'userId'), 'guest projects remain explicitly unowned');
    assert.ok(!Object.prototype.hasOwnProperty.call(guestAnalysisData, 'userId'), 'guest analyses remain explicitly unowned');
    assert.strictEqual(guestCreation.analysis.id, 'guest-analysis');

    console.log('Auth middleware tests passed.');
  } finally {
    (prisma as any).$transaction = originalTransaction;
    (prisma.user as any).findUnique = originalFindUnique;
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error('Auth middleware tests failed:', error);
  process.exitCode = 1;
});

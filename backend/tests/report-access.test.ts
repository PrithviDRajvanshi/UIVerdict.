import assert from 'assert';
import jwt from 'jsonwebtoken';
import { getReportById } from '../src/controllers/archive.controller';
import { postgresRepository } from '../src/repositories/postgres/postgres.repository';
import { config } from '../src/config/env';
import '../src/middleware/auth.middleware';

async function invokeController(req: any) {
  let statusCode = 0;
  let responseBody: any;
  let nextError: any;
  const res: any = {
    status(code: number) { statusCode = code; return this; },
    json(body: unknown) { responseBody = body; return this; },
  };
  await getReportById(req, res, (error?: unknown) => { nextError = error; });
  return { statusCode, responseBody, nextError };
}

async function runReportAccessTests() {
  const originalGetCompletedReport = postgresRepository.getCompletedReport;
  const observedAccess: unknown[] = [];
  const report = { id: 'guest-report-id', url: 'https://example.com' };

  try {
    postgresRepository.getCompletedReport = async (_id, access) => {
      observedAccess.push(access);
      if ('userId' in access && access.userId !== 'owner-id') return null;
      return report as any;
    };

    const owned = await invokeController({
      params: { analysisId: 'owned-report' },
      user: { id: 'owner-id' },
      cookies: {},
    });
    assert.strictEqual(owned.statusCode, 200);
    assert.deepStrictEqual(observedAccess.at(-1), { userId: 'owner-id' });

    const otherUser = await invokeController({
      params: { analysisId: 'owned-report' },
      user: { id: 'other-user' },
      cookies: {},
    });
    assert.strictEqual(otherUser.nextError?.statusCode, 404);
    assert.deepStrictEqual(observedAccess.at(-1), { userId: 'other-user' });

    const missingGuestToken = await invokeController({
      params: { analysisId: 'guest-report-id' },
      cookies: {},
    });
    assert.strictEqual(missingGuestToken.nextError?.statusCode, 404);

    const token = jwt.sign(
      { purpose: 'guest-report', analysisId: 'guest-report-id' },
      config.jwtSecret,
      { expiresIn: '1m' }
    );
    const guest = await invokeController({
      params: { analysisId: 'guest-report-id' },
      cookies: { 'guest_report_guest-report-id': token },
    });
    assert.strictEqual(guest.statusCode, 200);
    assert.deepStrictEqual(observedAccess.at(-1), { guest: true });

    const authenticatedGuestAttempt = await invokeController({
      params: { analysisId: 'guest-report-id' },
      user: { id: 'other-user' },
      cookies: { 'guest_report_guest-report-id': token },
    });
    assert.strictEqual(authenticatedGuestAttempt.nextError?.statusCode, 404);
    assert.deepStrictEqual(observedAccess.at(-1), { userId: 'other-user' });
  } finally {
    postgresRepository.getCompletedReport = originalGetCompletedReport;
  }
}

runReportAccessTests()
  .then(() => console.log('Report access unit tests passed.'))
  .catch((error) => {
    console.error('Report access unit tests failed:', error);
    process.exitCode = 1;
  });

import assert from 'assert';
import app from '../src/app';
import { authService } from '../src/services/auth.service';
import { getAuthCookieOptions, logout, register } from '../src/controllers/auth.controller';

interface CookieResponse {
  cookieCall?: { name: string; value: unknown; options: Record<string, unknown> };
  clearCookieCall?: { name: string; options: Record<string, unknown> };
  statusCode?: number;
}

function createResponse(calls: CookieResponse): any {
  return {
    cookie(name: string, value: unknown, options: Record<string, unknown>) {
      calls.cookieCall = { name, value, options };
      return this;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      calls.clearCookieCall = { name, options };
      return this;
    },
    status(statusCode: number) {
      calls.statusCode = statusCode;
      return this;
    },
    json() { return this; },
  };
}

async function run() {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRegister = authService.register;
  try {
    (authService as any).register = async () => ({
      user: { id: 'cookie-test-user', name: 'Cookie Test', email: 'cookie@example.test' },
      token: 'test-jwt',
    });

    assert.strictEqual(app.get('trust proxy'), 1, 'Express trusts exactly one proxy hop');

    for (const nodeEnv of ['production', 'development']) {
      process.env.NODE_ENV = nodeEnv;
      const expected = getAuthCookieOptions(nodeEnv);
      const setCalls: CookieResponse = {};
      await register({ body: { name: 'Cookie Test', email: 'cookie@example.test', password: 'Password123!' } } as any,
        createResponse(setCalls), (error) => { throw error; });

      assert.strictEqual(setCalls.cookieCall?.name, 'token');
      assert.deepStrictEqual(setCalls.cookieCall?.options, { ...expected, maxAge: 7 * 24 * 60 * 60 * 1000 });

      const clearCalls: CookieResponse = {};
      await logout({} as any, createResponse(clearCalls), (error) => { throw error; });
      assert.strictEqual(clearCalls.clearCookieCall?.name, 'token');
      assert.deepStrictEqual(clearCalls.clearCookieCall?.options, expected,
        `logout clears the ${nodeEnv} token cookie using matching scope/security options`);
      assert.strictEqual(clearCalls.statusCode, 200);
    }

    console.log('Auth cookie option tests passed.');
  } finally {
    authService.register = originalRegister;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
}

run().catch((error) => {
  console.error('Auth cookie option tests failed:', error);
  process.exitCode = 1;
});

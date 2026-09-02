import assert from 'assert';
import { authService } from '../src/services/auth.service';
import { postgresRepository } from '../src/repositories/postgres/postgres.repository';
import { prisma } from '../src/config/postgres';
import bcrypt from 'bcryptjs';

async function runAuthTests() {
  console.log('--- STARTING AUTHENTICATION & ARCHIVE UNIT TESTS ---');

  const testEmail = `test-user-${Date.now()}@uiverdict.io`;
  const testPassword = 'Password123!';
  const testName = 'Test Analyst';

  // Test 1: Successful Registration
  console.log('\n[Test 1] Successful User Registration');
  let user1: any = null;
  try {
    const regResult = await authService.register({
      name: testName,
      email: testEmail,
      password: testPassword,
    });
    user1 = regResult.user;
    assert.ok(user1.id, 'User ID should be generated');
    assert.strictEqual(user1.name, testName);
    assert.strictEqual(user1.email, testEmail);
    assert.ok(regResult.token, 'JWT token should be returned');
    console.log(`✓ Passed: User registered successfully (${user1.id})`);
  } catch (err: any) {
    console.error('⚠️ Registration test failed:', err);
    throw err;
  }

  // Test 2: Duplicate Email Rejection
  console.log('\n[Test 2] Duplicate Email Rejection');
  try {
    await authService.register({
      name: 'Duplicate Analyst',
      email: testEmail,
      password: testPassword,
    });
    assert.fail('Should have rejected duplicate email');
  } catch (err: any) {
    assert.strictEqual(err.statusCode, 400);
    assert.ok(err.message.includes('already exists'));
    console.log('✓ Passed: Duplicate email correctly rejected with 400 ApiError');
  }

  // Test 3: Password Hashing Verification
  console.log('\n[Test 3] Password Hashing Verification');
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: user1.id } });
    assert.ok(dbUser?.passwordHash, 'passwordHash must exist in DB');
    assert.notStrictEqual(dbUser?.passwordHash, testPassword, 'Password must not be stored in plaintext');
    const isBcryptMatch = await bcrypt.compare(testPassword, dbUser!.passwordHash);
    assert.strictEqual(isBcryptMatch, true, 'Stored hash must verify against original password using bcrypt');
    console.log('✓ Passed: Password securely hashed using bcrypt');
  } catch (err: any) {
    console.error('⚠️ Password hash verification failed:', err);
    throw err;
  }

  // Test 4: Successful Login
  console.log('\n[Test 4] Successful Login');
  try {
    const loginResult = await authService.login({
      email: testEmail,
      password: testPassword,
    });
    assert.strictEqual(loginResult.user.id, user1.id);
    assert.ok(loginResult.token, 'Login must return a valid token');
    console.log('✓ Passed: User authenticated successfully with valid credentials');
  } catch (err: any) {
    console.error('⚠️ Login failed:', err);
    throw err;
  }

  // Test 5: Invalid Credentials Rejection
  console.log('\n[Test 5] Invalid Credentials Rejection');
  try {
    await authService.login({
      email: testEmail,
      password: 'WrongPassword!',
    });
    assert.fail('Should have rejected invalid password');
  } catch (err: any) {
    assert.strictEqual(err.statusCode, 401);
    console.log('✓ Passed: Invalid credentials rejected with 401 ApiError');
  }

  // Test 6: getMe Retrieval
  console.log('\n[Test 6] /auth/me User Session Retrieval');
  try {
    const me = await authService.getMe(user1.id);
    assert.strictEqual(me.id, user1.id);
    assert.strictEqual(me.email, testEmail);
    console.log('✓ Passed: Currently authenticated user details retrieved correctly');
  } catch (err: any) {
    console.error('⚠️ getMe test failed:', err);
    throw err;
  }

  // Test 7: User Ownership Isolation & Archive Querying
  console.log('\n[Test 7] User Ownership Isolation & Archive Filtering');
  const user2Email = `test-user2-${Date.now()}@uiverdict.io`;
  const regResult2 = await authService.register({
    name: 'User Two',
    email: user2Email,
    password: testPassword,
  });
  const user2 = regResult2.user;

  // Create an analysis for User 1
  const analysis1 = await postgresRepository.createAnalysisTransaction(
    'https://user1-target.com',
    'User 1 Project',
    user1.id
  );

  // Create an analysis for User 2
  const analysis2 = await postgresRepository.createAnalysisTransaction(
    'https://user2-target.com',
    'User 2 Project',
    user2.id
  );

  // Query User 1 analyses from DB
  const user1Records = await prisma.analysis.findMany({ where: { userId: user1.id } });
  const user2Records = await prisma.analysis.findMany({ where: { userId: user2.id } });

  assert.ok(user1Records.some((r: any) => r.id === analysis1.analysis.id), 'User 1 must see User 1 analysis');
  assert.ok(!user1Records.some((r: any) => r.id === analysis2.analysis.id), 'User 1 must NOT see User 2 analysis');

  assert.ok(user2Records.some((r: any) => r.id === analysis2.analysis.id), 'User 2 must see User 2 analysis');
  assert.ok(!user2Records.some((r: any) => r.id === analysis1.analysis.id), 'User 2 must NOT see User 1 analysis');
  console.log('✓ Passed: Database level ownership isolation verified (User A cannot view User B analyses)');

  console.log('\n==================================================');
  console.log('ALL AUTHENTICATION & ARCHIVE UNIT TESTS COMPLETED SUCCESSFULLY');
  console.log('==================================================\n');
}

runAuthTests().catch((error) => {
  console.error('Auth test execution failed:', error);
  process.exit(1);
});

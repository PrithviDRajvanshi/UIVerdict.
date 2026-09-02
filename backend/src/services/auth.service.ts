import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/postgres';
import { ApiError } from '../errors/ApiError';
import { RegisterInput, LoginInput } from '../validators/auth.validator';

const JWT_SECRET = process.env.JWT_SECRET || 'uiverdict-secret-jwt-key';

export interface UserResponse {
  id: string;
  name: string;
  email: string;
}

export interface AuthResult {
  user: UserResponse;
  token: string;
}

export class AuthService {
  public async register(input: RegisterInput): Promise<AuthResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ApiError(400, 'An account with this email address already exists.');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await prisma.user.create({
      data: {
        name: input.name.trim(),
        email: normalizedEmail,
        passwordHash,
      },
    });

    const userPayload: UserResponse = {
      id: user.id,
      name: user.name,
      email: user.email,
    };

    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });

    return { user: userPayload, token };
  }

  public async login(input: LoginInput): Promise<AuthResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new ApiError(401, 'Invalid email address or password.');
    }

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid email address or password.');
    }

    const userPayload: UserResponse = {
      id: user.id,
      name: user.name,
      email: user.email,
    };

    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });

    return { user: userPayload, token };
  }

  public async getMe(userId: string): Promise<UserResponse> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new ApiError(404, 'User not found.');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
    };
  }
}

export const authService = new AuthService();

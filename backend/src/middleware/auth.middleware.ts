import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError } from '../errors/ApiError';
import { config } from '../config/env';
import { prisma } from '../config/postgres';

export interface JwtPayload {
  id: string;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const JWT_SECRET = config.jwtSecret;

const resolveAuthenticatedUser = async (req: Request): Promise<JwtPayload | null> => {
  let token = req.cookies?.token;
  const authorization = req.headers.authorization;

  if (!token && authorization) {
    if (!authorization.startsWith('Bearer ') || !authorization.slice(7).trim()) {
      throw new ApiError(401, 'Invalid or expired authentication session.');
    }
    token = authorization.slice(7).trim();
  }

  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & Partial<JwtPayload>;
    if (typeof decoded.id !== 'string' || !decoded.id) {
      throw new ApiError(401, 'Invalid or expired authentication session.');
    }

    // Resolve identity from PostgreSQL instead of trusting potentially stale JWT claims.
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, name: true },
    });
    if (!user) throw new ApiError(401, 'Invalid or expired authentication session.');

    return user;
  } catch (error: any) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(401, 'Invalid or expired authentication session.');
  }
};

const authenticate = (required: boolean) => (req: Request, _res: Response, next: NextFunction): void => {
  void resolveAuthenticatedUser(req).then((user) => {
    if (!user && required) {
      next(new ApiError(401, 'Unauthorized access. Please log in.'));
      return;
    }
    if (user) req.user = user;
    next();
  }).catch((error) => {
    if (req.cookies?.token && error instanceof ApiError && error.statusCode === 401) {
      _res.clearCookie('token', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    }
    next(error);
  });
};

export const authMiddleware = authenticate(true);
export const optionalAuthMiddleware = authenticate(false);

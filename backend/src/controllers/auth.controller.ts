import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { registerSchema, loginSchema } from '../validators/auth.validator';
import { ApiError } from '../errors/ApiError';

const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const getAuthCookieOptions = (nodeEnv = process.env.NODE_ENV) => ({
  httpOnly: true,
  sameSite: nodeEnv === 'production' ? 'none' as const : 'lax' as const,
  secure: nodeEnv === 'production',
});

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || 'Invalid registration data.';
      throw new ApiError(400, firstError);
    }

    const { user, token } = await authService.register(parseResult.data);

    res.cookie('token', token, { ...getAuthCookieOptions(), maxAge: AUTH_COOKIE_MAX_AGE_MS });
    res.status(201).json({
      status: 'success',
      message: 'Account created successfully',
      data: { user, token },
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || 'Invalid login credentials.';
      throw new ApiError(400, firstError);
    }

    const { user, token } = await authService.login(parseResult.data);

    res.cookie('token', token, { ...getAuthCookieOptions(), maxAge: AUTH_COOKIE_MAX_AGE_MS });
    res.status(200).json({
      status: 'success',
      message: 'Authentication successful',
      data: { user, token },
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.clearCookie('token', getAuthCookieOptions());
    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      throw new ApiError(401, 'Unauthorized access.');
    }

    const user = await authService.getMe(req.user.id);
    res.status(200).json({
      status: 'success',
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

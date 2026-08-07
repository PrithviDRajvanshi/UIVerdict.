import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/ApiError';

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(new ApiError(404, `Route ${req.originalUrl} not found`));
};

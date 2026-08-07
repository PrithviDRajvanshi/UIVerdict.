import { Request, Response } from 'express';
import { healthService } from '../services/health.service';

export const getRoot = (_req: Request, res: Response): void => {
  const info = healthService.getRootInfo();
  res.status(200).json(info);
};

export const getHealth = (_req: Request, res: Response): void => {
  const health = healthService.getHealthStatus();
  res.status(200).json(health);
};

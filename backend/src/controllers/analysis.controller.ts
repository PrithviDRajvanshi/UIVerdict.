import { Request, Response, NextFunction } from 'express';
import { analysisService } from '../services/analysis.service';

export const analyze = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { url } = req.body;
    const result = await analysisService.analyzeUrl(url);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

import { Request, Response, NextFunction } from 'express';
import { analysisService } from '../services/analysis.service';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export const analyze = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { url } = req.body;
    const userId = req.user?.id;
    const result = await analysisService.analyzeUrl(url, userId);
    if (!userId) {
      const analysisId = result.data.id;
      const guestToken = jwt.sign(
        { purpose: 'guest-report', analysisId },
        config.jwtSecret,
        { expiresIn: '30d' }
      );
      res.cookie(`guest_report_${analysisId}`, guestToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: `/api/v1/reports/${analysisId}`,
      });
    }
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

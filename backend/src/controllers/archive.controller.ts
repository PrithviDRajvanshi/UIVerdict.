import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/postgres';
import { AnalysisStatus } from '@prisma/client';
import { ApiError } from '../errors/ApiError';
import { postgresRepository } from '../repositories/postgres/postgres.repository';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export const getReportById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const analysisId = req.params.analysisId;
    let access: { userId: string } | { guest: true };

    if (req.user) {
      access = { userId: req.user.id };
    } else {
      const token = req.cookies?.[`guest_report_${analysisId}`];
      if (!token) throw new ApiError(404, 'Report not found.');

      try {
        const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload & {
          purpose?: string;
          analysisId?: string;
        };
        if (payload.purpose !== 'guest-report' || payload.analysisId !== analysisId) {
          throw new Error('Guest report token does not match the requested report');
        }
      } catch {
        throw new ApiError(404, 'Report not found.');
      }
      access = { guest: true };
    }

    const report = await postgresRepository.getCompletedReport(analysisId, access);
    if (!report) throw new ApiError(404, 'Report not found.');

    res.status(200).json({ status: 'success', data: report });
  } catch (error) {
    next(error);
  }
};

export const getArchiveAnalyses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      throw new ApiError(401, 'Unauthorized access. Please log in.');
    }

    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 10));
    const search = (req.query.search as string || '').trim();
    const statusParam = (req.query.status as string || 'ALL').trim().toUpperCase();

    const where: any = {
      userId,
    };

    if (statusParam === 'COMPLETE' || statusParam === 'COMPLETED') {
      where.status = AnalysisStatus.COMPLETED;
    } else if (statusParam === 'FAILED') {
      where.status = AnalysisStatus.FAILED;
    } else if (statusParam === 'PENDING' || statusParam === 'PROCESSING') {
      where.status = AnalysisStatus.PROCESSING;
    }

    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { url: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [total, records] = await Promise.all([
      prisma.analysis.count({ where }),
      prisma.analysis.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const items = records.map((record) => {
      let mappedStatus = 'PENDING';
      if (record.status === AnalysisStatus.COMPLETED) {
        mappedStatus = 'COMPLETE';
      } else if (record.status === AnalysisStatus.FAILED) {
        mappedStatus = 'FAILED';
      }

      return {
        id: record.id,
        targetUrl: record.url,
        date: record.createdAt.toISOString().slice(0, 10),
        score: record.overallScore !== null && record.overallScore !== undefined ? Math.round(record.overallScore) : 0,
        status: mappedStatus,
        createdAt: record.createdAt,
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;

    res.status(200).json({
      status: 'success',
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

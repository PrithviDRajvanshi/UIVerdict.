import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/postgres';
import { mongoRepository } from '../repositories/mongo/mongo.repository';
import { AnalysisStatus } from '@prisma/client';
import { ApiError } from '../errors/ApiError';

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

    const items = await Promise.all(
      records.map(async (record) => {
        let score: number | null = null;
        try {
          const snapshot = await mongoRepository.getSnapshotByAnalysisId(record.id);
          if (snapshot && snapshot.aiAnalysis && snapshot.aiAnalysis.overallVerdict) {
            score = snapshot.aiAnalysis.overallVerdict.score;
          }
        } catch {
          // Ignore Mongo retrieval errors gracefully
        }

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
          score: score !== null ? Math.round(score) : 0,
          status: mappedStatus,
          createdAt: record.createdAt,
        };
      })
    );

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

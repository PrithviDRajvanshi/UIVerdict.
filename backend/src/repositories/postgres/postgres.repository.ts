import { prisma } from '../../config/postgres';
import { Analysis, AnalysisStatus, Project } from '@prisma/client';

export class PostgresRepository {
  /**
   * Executes a Prisma transaction to resolve/create a Project and create an Analysis record.
   */
  public async createAnalysisTransaction(
    url: string,
    projectName = 'Default Project',
    userId?: string
  ): Promise<{ project: Project; analysis: Analysis }> {
    return await prisma.$transaction(async (tx) => {
      let project = await tx.project.findFirst({
        where: {
          name: projectName,
          ...(userId ? { userId } : {}),
        },
      });

      if (!project) {
        project = await tx.project.create({
          data: {
            name: projectName,
            ...(userId ? { userId } : {}),
          },
        });
      }

      const analysis = await tx.analysis.create({
        data: {
          projectId: project.id,
          url,
          status: AnalysisStatus.PROCESSING,
          ...(userId ? { userId } : {}),
        },
      });

      return { project, analysis };
    });
  }

  /**
   * Updates an Analysis record status and optional mongoDocumentId.
   */
  public async updateAnalysisStatus(
    analysisId: string,
    status: AnalysisStatus,
    mongoDocumentId?: string
  ): Promise<Analysis> {
    return await prisma.analysis.update({
      where: { id: analysisId },
      data: {
        status,
        ...(mongoDocumentId ? { mongoDocumentId } : {}),
      },
    });
  }

  /**
   * Retrieves an Analysis record by ID.
   */
  public async findAnalysisById(analysisId: string): Promise<Analysis | null> {
    return await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { project: true },
    });
  }

  /**
   * Retrieves all Analysis records for a given Project.
   */
  public async findAnalysesByProject(projectId: string): Promise<Analysis[]> {
    return await prisma.analysis.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const postgresRepository = new PostgresRepository();

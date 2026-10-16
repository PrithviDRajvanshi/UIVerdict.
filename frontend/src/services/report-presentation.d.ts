import type { ReportData } from '../types/report';

export function getReportPresentation(
  status: ReportData['status'],
  aiStatus: ReportData['aiStatus'],
): {
  validated: boolean;
  retryAvailable: boolean;
  targetMessage: string | null;
  aiUnavailable: boolean;
  scoresAvailable: boolean;
};

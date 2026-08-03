import reportMock from '../data/report.json';
import { ReportData } from '../types/report';

export async function fetchReportById(id: string): Promise<ReportData> {
  return {
    ...reportMock,
    evaluationId: id || reportMock.evaluationId,
  } as ReportData;
}

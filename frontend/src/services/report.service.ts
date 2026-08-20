import reportMock from '../data/report.json';
import { ReportData } from '../types/report';

const reportsCache = new Map<string, ReportData>();

export function storeReport(report: ReportData): void {
  if (!report || !report.evaluationId) return;
  reportsCache.set(report.evaluationId, report);
  try {
    sessionStorage.setItem(`uiverdict_report_${report.evaluationId}`, JSON.stringify(report));
    sessionStorage.setItem('uiverdict_latest_report', JSON.stringify(report));
  } catch (e) {
    // Ignore storage errors
  }
}

export async function fetchReportById(id?: string): Promise<ReportData> {
  if (id && reportsCache.has(id)) {
    return reportsCache.get(id)!;
  }

  if (id) {
    try {
      const stored = sessionStorage.getItem(`uiverdict_report_${id}`);
      if (stored) {
        const parsed = JSON.parse(stored) as ReportData;
        reportsCache.set(id, parsed);
        return parsed;
      }
    } catch (e) {
      // Ignore storage errors
    }
  }

  try {
    const latest = sessionStorage.getItem('uiverdict_latest_report');
    if (latest) {
      const parsed = JSON.parse(latest) as ReportData;
      if (!id || id === parsed.evaluationId || id === 'latest' || id === '749-X2') {
        return parsed;
      }
    }
  } catch (e) {
    // Ignore storage errors
  }

  return {
    ...reportMock,
    evaluationId: id || reportMock.evaluationId,
  } as ReportData;
}

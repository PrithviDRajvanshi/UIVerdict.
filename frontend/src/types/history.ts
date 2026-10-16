export interface HistoryItem {
  id: string;
  date: string;
  targetUrl: string;
  score: number | null;
  status: 'COMPLETE' | 'FAILED' | 'PENDING';
}

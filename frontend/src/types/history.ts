export interface HistoryItem {
  id: string;
  date: string;
  targetUrl: string;
  score: number;
  status: 'COMPLETE' | 'FAILED' | 'PENDING';
}

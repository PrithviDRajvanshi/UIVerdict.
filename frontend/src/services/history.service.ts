import historyMock from '../data/history.json';
import { HistoryItem } from '../types/history';

export async function fetchHistoryLogs(): Promise<HistoryItem[]> {
  return historyMock as HistoryItem[];
}

import { HistoryItem } from '../types/history';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface ArchivePagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ArchiveResponseData {
  items: HistoryItem[];
  pagination: ArchivePagination;
}

export interface FetchArchiveOptions {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}

export async function fetchArchiveData(options: FetchArchiveOptions = {}): Promise<ArchiveResponseData> {
  const { page = 1, limit = 10, search = '', status = 'ALL' } = options;

  const params = new URLSearchParams();
  params.append('page', page.toString());
  params.append('limit', limit.toString());
  if (search.trim()) {
    params.append('search', search.trim());
  }
  if (status && status !== 'ALL') {
    params.append('status', status);
  }

  const response = await fetch(`${API_URL}/api/v1/analyses?${params.toString()}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to retrieve archive evaluation logs.');
  }

  const json = await response.json();
  return json.data as ArchiveResponseData;
}

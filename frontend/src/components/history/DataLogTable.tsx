import React from 'react';
import { HistoryItem } from '../../types/history';
import { ArchivePagination } from '../../services/history.service';
import { Link } from 'react-router-dom';

interface DataLogTableProps {
  logs: HistoryItem[];
  pagination: ArchivePagination;
  search: string;
  onSearchChange: (search: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  loading: boolean;
}

export const DataLogTable: React.FC<DataLogTableProps> = ({
  logs,
  pagination,
  search,
  onSearchChange,
  page,
  onPageChange,
  loading,
}) => {
  const from = pagination.total > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const to = Math.min(pagination.page * pagination.limit, pagination.total);

  const renderPageButtons = () => {
    const totalPages = pagination.totalPages || 1;
    const buttons = [];

    const startPage = Math.max(1, page - 2);
    const endPage = Math.min(totalPages, startPage + 4);

    for (let p = startPage; p <= endPage; p++) {
      buttons.push(
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={`tech-button w-8 h-8 flex items-center justify-center cursor-pointer ${
            page === p ? 'bg-primary text-[#090909] font-bold' : ''
          }`}
        >
          {p}
        </button>
      );
    }

    return buttons;
  };

  return (
    <main className="flex-1 flex flex-col bg-[#141313]">
      {/* Header & Controls */}
      <div className="p-6 border-b border-border-color flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#141313]">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-primary uppercase">Data Log</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">Historical evaluation records.</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative w-full md:w-64">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">
              search
            </span>
            <input
              className="tech-input w-full pl-9 pr-3 py-2 font-mono-data text-mono-data bg-[#0e0e0e] text-[#f5f5f5] border-[#2a2a2a] outline-none focus:border-primary"
              placeholder="Search ID or Target..."
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Data Table Container */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="w-full min-w-[800px] flex flex-col border border-border-color bg-[#141313]">
          {/* Table Header */}
          <div className="grid grid-cols-12 border-b border-border-color bg-[#1c1b1b] text-[#a8a8a8]">
            <div className="col-span-2 grid-cell font-label-sm text-label-sm border-r-0 border-t-0 border-l-0 text-[#F5F5F5] p-3">
              DATE
            </div>
            <div className="col-span-2 grid-cell font-label-sm text-label-sm border-r-0 border-t-0 border-l-0 text-[#F5F5F5] p-3">
              ID
            </div>
            <div className="col-span-4 grid-cell font-label-sm text-label-sm border-r-0 border-t-0 border-l-0 text-[#F5F5F5] p-3">
              TARGET URL
            </div>
            <div className="col-span-2 grid-cell font-label-sm text-label-sm border-r-0 border-t-0 border-l-0 text-[#F5F5F5] text-right p-3">
              SCORE
            </div>
            <div className="col-span-2 grid-cell font-label-sm text-label-sm border-t-0 border-l-0 border-r-0 text-[#F5F5F5] text-center p-3">
              STATUS
            </div>
          </div>

          {/* Table Body */}
          <div className="flex flex-col min-h-[200px]">
            {loading ? (
              <div className="p-8 text-center font-mono-data text-on-surface-variant flex items-center justify-center gap-2">
                <span className="animate-spin text-primary">⟳</span>
                FETCHING EVALUATION ARCHIVE...
              </div>
            ) : logs.length === 0 ? (
              <div className="p-8 text-center font-mono-data text-on-surface-variant">
                NO EVALUATION RECORDS FOUND
              </div>
            ) : (
              logs.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-12 hover:bg-[#1c1b1b] transition-colors border-b border-border-color p-3"
                >
                  <div className="col-span-2 font-mono-data text-mono-data text-[#F5F5F5] flex items-center">
                    {row.date}
                  </div>
                  <div className="col-span-2 font-mono-data text-mono-data text-primary flex items-center truncate">
                    <Link to={`/report/${row.id}`} className="text-primary hover:underline no-underline truncate" title={row.id}>
                      {row.id.length > 12 ? `${row.id.substring(0, 10)}...` : row.id}
                    </Link>
                  </div>
                  <div className="col-span-4 font-mono-data text-mono-data text-[#F5F5F5] flex items-center truncate" title={row.targetUrl}>
                    {row.targetUrl}
                  </div>
                  <div className="col-span-2 flex flex-col justify-center items-end gap-1 text-[#F5F5F5]">
                    <span className="font-mono-data text-mono-data text-primary">{row.score}%</span>
                    <div className="progress-bar-bg w-full">
                      <div
                        className={`progress-bar-fill ${row.status === 'FAILED' ? 'bg-[#ffb4ab]' : 'bg-[#ffffff]'}`}
                        style={{ width: `${Math.min(100, Math.max(0, row.score))}%` }}
                      />
                    </div>
                  </div>
                  <div className="col-span-2 flex items-center justify-center text-[#F5F5F5]">
                    <span
                      className={`tech-chip font-label-sm text-[10px] ${
                        row.status === 'COMPLETE'
                          ? 'status-badge-complete'
                          : row.status === 'FAILED'
                          ? 'status-badge-failed'
                          : 'border-yellow-600 text-yellow-400 bg-yellow-950/40'
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row justify-between items-center mt-6 gap-4">
          <div className="font-mono-data text-mono-data text-on-surface-variant">
            Showing {from}-{to} of {pagination.total} records
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || loading}
              className="tech-button w-8 h-8 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>
            {renderPageButtons()}
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= pagination.totalPages || loading}
              className="tech-button w-8 h-8 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
};

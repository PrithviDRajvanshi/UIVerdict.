import React, { useState } from 'react';
import { HistoryItem } from '../../types/history';
import { Link } from 'react-router-dom';

interface DataLogTableProps {
  logs: HistoryItem[];
}

export const DataLogTable: React.FC<DataLogTableProps> = ({ logs }) => {
  const [search, setSearch] = useState('');

  const filteredLogs = logs.filter(
    (item) =>
      item.id.toLowerCase().includes(search.toLowerCase()) ||
      item.targetUrl.toLowerCase().includes(search.toLowerCase())
  );

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
              className="tech-input w-full pl-9 pr-3 py-2 font-mono-data text-mono-data bg-[#0e0e0e] text-[#f5f5f5] border-[#2a2a2a] outline-none"
              placeholder="Search ID or Target..."
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="tech-button px-3 py-2 flex items-center justify-center cursor-pointer" title="Sort Options">
            <span className="material-symbols-outlined text-sm">sort</span>
          </button>
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
          <div className="flex flex-col">
            {filteredLogs.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-12 hover:bg-[#1c1b1b] transition-colors border-b border-border-color p-3"
              >
                <div className="col-span-2 font-mono-data text-mono-data text-[#F5F5F5] flex items-center">
                  {row.date}
                </div>
                <div className="col-span-2 font-mono-data text-mono-data text-primary flex items-center">
                  <Link to={`/report/${row.id}`} className="text-primary hover:underline no-underline">
                    {row.id}
                  </Link>
                </div>
                <div className="col-span-4 font-mono-data text-mono-data text-[#F5F5F5] flex items-center truncate">
                  {row.targetUrl}
                </div>
                <div className="col-span-2 flex flex-col justify-center items-end gap-1 text-[#F5F5F5]">
                  <span className="font-mono-data text-mono-data text-primary">{row.score}%</span>
                  <div className="progress-bar-bg w-full">
                    <div
                      className={`progress-bar-fill ${row.status === 'FAILED' ? 'bg-[#ffb4ab]' : 'bg-[#ffffff]'}`}
                      style={{ width: `${row.score}%` }}
                    />
                  </div>
                </div>
                <div className="col-span-2 flex items-center justify-center text-[#F5F5F5]">
                  <span
                    className={`tech-chip font-label-sm text-[10px] ${
                      row.status === 'COMPLETE' ? 'status-badge-complete' : 'status-badge-failed'
                    }`}
                  >
                    {row.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pagination */}
        <div className="flex justify-between items-center mt-6">
          <div className="font-mono-data text-mono-data text-on-surface-variant">
            Showing 1-{filteredLogs.length} of 248 records
          </div>
          <div className="flex gap-2">
            <button className="tech-button w-8 h-8 flex items-center justify-center disabled:opacity-50" disabled>
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>
            <button className="tech-button w-8 h-8 flex items-center justify-center bg-primary text-[#090909]">1</button>
            <button className="tech-button w-8 h-8 flex items-center justify-center">2</button>
            <button className="tech-button w-8 h-8 flex items-center justify-center">3</button>
            <span className="font-mono-data flex items-center px-1 text-on-surface-variant">...</span>
            <button className="tech-button w-8 h-8 flex items-center justify-center">50</button>
            <button className="tech-button w-8 h-8 flex items-center justify-center">
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
};

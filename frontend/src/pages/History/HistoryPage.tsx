import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterSidebar } from '../../components/history/FilterSidebar';
import { DataLogTable } from '../../components/history/DataLogTable';
import { fetchArchiveData, ArchivePagination } from '../../services/history.service';
import { HistoryItem } from '../../types/history';
import { useAuth } from '../../contexts/AuthContext';

export const HistoryPage: React.FC = () => {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [logs, setLogs] = useState<HistoryItem[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [pagination, setPagination] = useState<ArchivePagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });

  const loadData = async (targetPage: number, targetStatus: string, targetSearch: string) => {
    try {
      setLoading(true);
      const res = await fetchArchiveData({
        page: targetPage,
        limit: 10,
        status: targetStatus,
        search: targetSearch,
      });
      setLogs(res.items);
      setPagination(res.pagination);
    } catch {
      setLogs([]);
      setPagination({ page: 1, limit: 10, total: 0, totalPages: 1 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    loadData(page, selectedStatus, search);
  }, [isAuthenticated, page, selectedStatus, search]);

  const handleSelectStatus = (status: string) => {
    setSelectedStatus(status);
    setPage(1);
  };

  const handleSearchChange = (newSearch: string) => {
    setSearch(newSearch);
    setPage(1);
  };

  const handleExportLog = () => {
    if (!logs.length) return;
    const jsonString = JSON.stringify(logs, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uiverdict-archive-log-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[70vh] font-mono-data text-on-surface-variant">
        <span className="animate-spin text-primary mr-2">⟳</span>
        VERIFYING ANALYST SESSION...
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-container-max mx-auto border-x border-[#2a2a2a] min-h-[70vh] p-8 text-center">
        <div className="max-w-md p-8 bg-[#151515] border border-[#2a2a2a] flex flex-col items-center">
          <span className="material-symbols-outlined text-4xl text-primary mb-3">lock</span>
          <h2 className="font-headline-lg text-headline-lg text-primary uppercase mb-2">ARCHIVE ACCESS RESTRICTED</h2>
          <p className="font-body-md text-body-md text-[#888888] mb-6">
            Evaluation logs and historical audit telemetry require analyst authentication.
          </p>
          <div className="flex gap-4">
            <Link
              to="/login"
              className="tech-button px-6 py-3 font-label-sm text-label-sm uppercase bg-brand-dark text-primary no-underline"
            >
              LOG IN
            </Link>
            <Link
              to="/register"
              className="tech-button px-6 py-3 font-label-sm text-label-sm uppercase bg-primary text-brand-dark no-underline"
            >
              SIGN UP
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col md:flex-row w-full max-w-container-max mx-auto border-x border-[#2a2a2a] min-h-[80vh]">
      <FilterSidebar
        selectedStatus={selectedStatus}
        onSelectStatus={handleSelectStatus}
        onExportLog={handleExportLog}
      />
      <DataLogTable
        logs={logs}
        pagination={pagination}
        search={search}
        onSearchChange={handleSearchChange}
        page={page}
        onPageChange={setPage}
        loading={loading}
      />
    </div>
  );
};

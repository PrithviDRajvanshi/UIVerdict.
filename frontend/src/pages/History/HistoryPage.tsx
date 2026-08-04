import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterSidebar } from '../../components/history/FilterSidebar';
import { DataLogTable } from '../../components/history/DataLogTable';
import { fetchHistoryLogs } from '../../services/history.service';
import { HistoryItem } from '../../types/history';
import { useAuth } from '../../contexts/AuthContext';

export const HistoryPage: React.FC = () => {
  const [logs, setLogs] = useState<HistoryItem[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    fetchHistoryLogs().then(setLogs);
  }, []);

  const filteredLogs =
    selectedStatus === 'ALL'
      ? logs
      : logs.filter((item) => item.status === selectedStatus);

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
      <FilterSidebar selectedStatus={selectedStatus} onSelectStatus={setSelectedStatus} />
      <DataLogTable logs={filteredLogs} />
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { FilterSidebar } from '../../components/history/FilterSidebar';
import { DataLogTable } from '../../components/history/DataLogTable';
import { fetchHistoryLogs } from '../../services/history.service';
import { HistoryItem } from '../../types/history';

export const HistoryPage: React.FC = () => {
  const [logs, setLogs] = useState<HistoryItem[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  useEffect(() => {
    fetchHistoryLogs().then(setLogs);
  }, []);

  const filteredLogs =
    selectedStatus === 'ALL'
      ? logs
      : logs.filter((item) => item.status === selectedStatus);

  return (
    <div className="flex-1 flex flex-col md:flex-row w-full max-w-container-max mx-auto border-x border-[#2a2a2a] min-h-[80vh]">
      <FilterSidebar selectedStatus={selectedStatus} onSelectStatus={setSelectedStatus} />
      <DataLogTable logs={filteredLogs} />
    </div>
  );
};

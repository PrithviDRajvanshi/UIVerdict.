import React from 'react';

interface ReportHeaderProps {
  evaluationId: string;
  algorithm: string;
  timestamp: string;
  latency: string;
}

export const ReportHeader: React.FC<ReportHeaderProps> = ({
  evaluationId,
  algorithm,
  timestamp,
  latency,
}) => {
  return (
    <header className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-theme-border pb-stack-md gap-4">
      <div>
        <h1 className="font-display-lg text-display-lg uppercase">EVALUATION ID: {evaluationId}</h1>
        <p className="font-mono-data text-mono-data text-[#888888] mt-2">{algorithm}</p>
      </div>
      <div className="text-right">
        <div className="font-mono-data text-mono-data text-[#888888] flex items-center justify-end gap-2">
          <span className="material-symbols-outlined text-sm">schedule</span>
          TS: {timestamp}
        </div>
        <div className="font-mono-data text-mono-data text-[#888888] flex items-center justify-end gap-2 mt-1">
          <span className="material-symbols-outlined text-sm">speed</span>
          LATENCY: {latency}
        </div>
      </div>
    </header>
  );
};

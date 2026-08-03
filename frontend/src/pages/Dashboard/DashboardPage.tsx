import React, { useEffect, useState } from 'react';
import { MetricsOverview } from '../../components/dashboard/MetricsOverview';
import { ProtocolList } from '../../components/dashboard/ProtocolList';
import { fetchAnalysisOverview } from '../../services/analysis.service';
import { AnalysisOverviewData } from '../../types/analysis';

export const DashboardPage: React.FC = () => {
  const [data, setData] = useState<AnalysisOverviewData | null>(null);

  useEffect(() => {
    fetchAnalysisOverview().then(setData);
  }, []);

  return (
    <div className="max-w-container-max mx-auto px-margin-desktop py-stack-lg flex flex-col gap-stack-lg">
      <div className="border-b border-[#2a2a2a] pb-4 flex justify-between items-end">
        <div>
          <h1 className="font-display-lg text-display-lg uppercase">System Dashboard</h1>
          <p className="font-mono-data text-mono-data text-[#888888] mt-2">Active telemetry & analysis networks</p>
        </div>
        <span className="font-mono-data text-mono-data border border-[#2a2a2a] px-3 py-1 text-[#80DEEA] uppercase">
          LIVE TELEMETRY
        </span>
      </div>

      {data && (
        <>
          <MetricsOverview metrics={data.metricsOverview} />
          <ProtocolList protocols={data.protocols} />
        </>
      )}
    </div>
  );
};

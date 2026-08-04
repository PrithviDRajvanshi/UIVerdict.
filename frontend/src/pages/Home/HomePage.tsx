import React, { useEffect, useState } from 'react';
import { HeroSection } from '../../components/hero/HeroSection';
import { ProtocolList } from '../../components/dashboard/ProtocolList';
import { fetchAnalysisOverview } from '../../services/analysis.service';
import { AnalysisOverviewData } from '../../types/analysis';

export const HomePage: React.FC = () => {
  const [data, setData] = useState<AnalysisOverviewData | null>(null);

  useEffect(() => {
    fetchAnalysisOverview().then(setData);
  }, []);

  return (
    <main className="flex-grow w-full relative">
      <HeroSection />
      {data && <ProtocolList protocols={data.protocols} />}
    </main>
  );
};

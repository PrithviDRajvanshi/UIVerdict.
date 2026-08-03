import React from 'react';
import { ReportMetrics } from '../../types/report';

interface StatisticsChartProps {
  metrics: ReportMetrics;
}

export const StatisticsChart: React.FC<StatisticsChartProps> = ({ metrics }) => {
  return (
    <section className="border-panel bg-panel flex flex-col mt-4">
      <div className="border-b border-[#2a2a2a] p-4 flex justify-between items-center">
        <h2 className="font-headline-md text-headline-md uppercase text-primary">Statistics</h2>
        <span className="font-label-sm text-label-sm text-[#888888] border border-[#2a2a2a] px-2 py-1 uppercase">
          Core Metrics
        </span>
      </div>
      <div className="p-8 bg-[#090909] relative overflow-hidden min-h-[400px] flex flex-col justify-center">
        <div className="w-full max-w-4xl mx-auto relative h-64 flex flex-col ml-8">
          <div className="absolute -left-8 top-0 h-full flex flex-col justify-between font-mono-data text-[10px] text-[#888888] pointer-events-none">
            <span>100</span>
            <span>75</span>
            <span>50</span>
            <span>25</span>
            <span>0</span>
          </div>
          <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 1000 200">
            {/* Grid Lines */}
            <line stroke="#2a2a2a" strokeWidth="1" x1="0" x2="1000" y1="0" y2="0" />
            <line stroke="#2a2a2a" strokeWidth="1" x1="0" x2="1000" y1="50" y2="50" />
            <line stroke="#2a2a2a" strokeWidth="1" x1="0" x2="1000" y1="100" y2="100" />
            <line stroke="#2a2a2a" strokeWidth="1" x1="0" x2="1000" y1="150" y2="150" />
            <line stroke="#2a2a2a" strokeWidth="1" x1="0" x2="1000" y1="200" y2="200" />

            {/* Data Line */}
            <polyline
              className="transition-all duration-1000"
              fill="none"
              points="0,4 333,10 666,0 1000,16"
              stroke="#80DEEA"
              strokeWidth="2"
            />
            {/* Data Points */}
            <circle cx="0" cy="4" fill="#80DEEA" r="4" />
            <circle cx="333" cy="10" fill="#80DEEA" r="4" />
            <circle cx="666" cy="0" fill="#80DEEA" r="4" />
            <circle cx="1000" cy="16" fill="#80DEEA" r="4" />
          </svg>

          {/* X-Axis Labels */}
          <div className="flex justify-between mt-6">
            <div className="flex flex-col items-start">
              <span className="font-label-sm text-[#888888] uppercase">Performance</span>
              <span className="font-mono-data text-primary">{metrics.performance}</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="font-label-sm text-[#888888] uppercase">Accessibility</span>
              <span className="font-mono-data text-primary">{metrics.accessibility}</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="font-label-sm text-[#888888] uppercase">Best Practices</span>
              <span className="font-mono-data text-primary">{metrics.bestPractices}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-label-sm text-[#888888] uppercase">SEO</span>
              <span className="font-mono-data text-primary">{metrics.seoStructure}</span>
            </div>
          </div>
        </div>

        {/* Technical Grid Overlay */}
        <div className="absolute inset-0 pointer-events-none border border-[#2a2a2a]/50">
          <div className="absolute top-1/4 left-0 w-full h-[1px] bg-[#2a2a2a]/10"></div>
          <div className="absolute top-2/4 left-0 w-full h-[1px] bg-[#2a2a2a]/10"></div>
          <div className="absolute top-3/4 left-0 w-full h-[1px] bg-[#2a2a2a]/10"></div>
        </div>
      </div>
    </section>
  );
};

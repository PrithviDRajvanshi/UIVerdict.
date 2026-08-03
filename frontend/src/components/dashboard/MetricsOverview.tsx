import React from 'react';
import { MetricOverview } from '../../types/analysis';

interface MetricsOverviewProps {
  metrics: MetricOverview[];
}

export const MetricsOverview: React.FC<MetricsOverviewProps> = ({ metrics }) => {
  return (
    <section className="w-full max-w-container-max mx-auto px-margin-desktop py-16">
      <div className="mb-12 border-b border-brand-border pb-4 flex items-end justify-between">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary uppercase">Metrics Overview</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-2">Core evaluation parameters.</p>
        </div>
        <span className="font-mono-data text-mono-data text-outline-variant">SYS_V.1.0</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter bg-brand-border border border-brand-border p-gutter">
        {metrics.map((item, index) => (
          <div
            key={index}
            className="bg-[#151515] p-6 flex flex-col justify-between aspect-square group hover:bg-[#1a1a1a] transition-colors relative overflow-hidden"
          >
            <div className="flex justify-between items-start mb-8">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest border border-brand-border px-2 py-1">
                {item.title}
              </span>
              <span className="material-symbols-outlined text-outline-variant group-hover:text-primary transition-colors">
                {item.icon}
              </span>
            </div>
            <div>
              <div className="font-display-lg text-display-lg text-primary tracking-tighter">
                {item.score}
                <span className="text-outline-variant text-headline-lg">/{item.maxScore}</span>
              </div>
              <div className="font-mono-data text-mono-data text-on-surface-variant mt-2 flex items-center">
                <span className="w-1.5 h-1.5 bg-primary mr-2 block"></span>
                {item.subtitle}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

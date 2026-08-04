import React from 'react';
import { Link } from 'react-router-dom';
import { ReportMetrics } from '../../types/report';

interface ScorePanelProps {
  overallScore: number;
  verdictStatus: string;
  metrics: ReportMetrics;
  isAuthenticated?: boolean;
}

export const ScorePanel: React.FC<ScorePanelProps> = ({
  overallScore,
  verdictStatus,
  metrics,
  isAuthenticated = true,
}) => {
  return (
    <div className="md:col-span-4 bg-[#151515] border border-[#2a2a2a] flex flex-col h-full">
      <div className="border-b border-[#2a2a2a] p-4">
        <h2 className="font-headline-md text-headline-md uppercase text-primary">Overall Verdict</h2>
      </div>
      <div className="p-6 flex-grow flex flex-col gap-6">
        <div className="flex items-center gap-6">
          <div className="text-[84px] font-bold leading-none tracking-tighter text-primary">
            {overallScore}
          </div>
          <div className="flex flex-col">
            <span className="font-label-sm text-label-sm text-[#888888] uppercase">Global Score</span>
            <span className="font-label-sm text-label-sm text-[#f5f5f5] border border-[#2a2a2a] px-2 py-1 mt-1 uppercase">
              {verdictStatus}
            </span>
          </div>
        </div>
        <hr className="border-[#2a2a2a] border-t-1" />
        {isAuthenticated ? (
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex justify-between font-mono-data text-mono-data mb-1 text-primary">
                <span>PERFORMANCE</span>
                <span>{metrics.performance}</span>
              </div>
              <div className="h-2 progress-bar-bg w-full">
                <div className="h-full progress-bar-fill" style={{ width: `${metrics.performance}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between font-mono-data text-mono-data mb-1 text-primary">
                <span>ACCESSIBILITY</span>
                <span>{metrics.accessibility}</span>
              </div>
              <div className="h-2 progress-bar-bg w-full">
                <div className="h-full progress-bar-fill" style={{ width: `${metrics.accessibility}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between font-mono-data text-mono-data mb-1 text-primary">
                <span>BEST PRACTICES</span>
                <span>{metrics.bestPractices}</span>
              </div>
              <div className="h-2 progress-bar-bg w-full">
                <div className="h-full progress-bar-fill" style={{ width: `${metrics.bestPractices}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between font-mono-data text-mono-data mb-1 text-primary">
                <span>SEO STRUCTURE</span>
                <span>{metrics.seoStructure}</span>
              </div>
              <div className="h-2 progress-bar-bg w-full">
                <div className="h-full progress-bar-fill" style={{ width: `${metrics.seoStructure}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center border border-[#2a2a2a] bg-[#090909]">
            <span className="material-symbols-outlined text-2xl text-[#888888] mb-2">lock</span>
            <span className="font-mono-data text-mono-data text-primary uppercase mb-1">
              Category metrics locked
            </span>
            <p className="font-body-md text-body-md text-[#888888] mb-4 text-xs">
              Sign up to unlock detailed UI/UX analysis.
            </p>
            <Link
              to="/register"
              className="tech-button px-4 py-2 font-label-sm text-label-sm uppercase bg-primary text-brand-dark no-underline"
            >
              SIGN UP
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

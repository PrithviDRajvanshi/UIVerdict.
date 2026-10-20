import React from 'react';
import { Link } from 'react-router-dom';
import { ReportData, ReportMetrics } from '../../types/report';

interface ScorePanelProps {
  overallScore: number | null;
  visualDesignScore: number | null;
  verdictStatus: string;
  metrics: ReportMetrics;
  mode: ReportData['mode'];
  isAuthenticated?: boolean;
}

export const ScorePanel: React.FC<ScorePanelProps> = ({
  overallScore,
  visualDesignScore,
  verdictStatus,
  metrics,
  mode,
  isAuthenticated = true,
}) => {
  const hasDisplayMetric = (value?: string) => Boolean(value?.trim() && value.trim().toLowerCase() !== 'n/a');
  const hasWebVitals = [metrics.firstContentfulPaint, metrics.largestContentfulPaint, metrics.speedIndex,
    metrics.totalBlockingTime, metrics.timeToInteractive].some(hasDisplayMetric) || metrics.cumulativeLayoutShift != null;
  const hasLighthouseScores = [metrics.performance, metrics.accessibility, metrics.bestPractices, metrics.seoStructure]
    .some((score) => score !== null);
  const showVisual = mode === 'visual' || mode === 'overall' || (mode === 'unknown' && visualDesignScore !== null);
  const showTechnical = mode === 'tech' || mode === 'overall' || (mode === 'unknown' && (hasLighthouseScores || hasWebVitals));
  const displayScore = mode === 'visual' ? visualDesignScore : mode === 'overall' ? overallScore : null;

  return (
    <div className={`${mode === 'tech' ? 'md:col-span-1' : 'md:col-span-4'} bg-[#151515] border border-[#2a2a2a] flex flex-col h-full`}>
      <div className="border-b border-[#2a2a2a] p-4 flex justify-between items-center">
        <h2 className="font-headline-md text-headline-md uppercase text-primary">
          {mode === 'visual' ? 'Visual Assessment' : mode === 'tech' ? 'Technical Assessment' : 'Overall Website Score'}
        </h2>
        <span className="font-mono-data text-[10px] text-[#80DEEA] uppercase tracking-wider">
          {mode === 'tech' ? 'Lighthouse' : mode === 'visual' ? 'Gemini' : 'Combined Results'}
        </span>
      </div>
      <div className="p-6 flex-grow flex flex-col gap-6">
        {showVisual && (
          <>
            <div className="flex items-center gap-6">
              <div className="text-[84px] font-bold leading-none tracking-tighter text-primary">{displayScore ?? '—'}</div>
              <div className="flex flex-col">
                <span className="font-label-sm text-label-sm text-[#888888] uppercase">{mode === 'visual' ? 'Visual Score' : 'Verdict'}</span>
                <span className="font-label-sm text-label-sm text-[#f5f5f5] border border-[#2a2a2a] px-2 py-1 mt-1 uppercase">
                  {mode === 'visual' ? displayScore === null ? 'UNAVAILABLE' : 'VISUAL' : overallScore === null ? 'UNAVAILABLE' : verdictStatus}
                </span>
              </div>
            </div>
            <p className="font-mono-data text-[11px] text-[#888888] tracking-wide mt-1">
              {mode === 'visual' ? 'Screenshot-only visual score; no combined score is generated'
                : mode === 'overall' ? 'Legacy combined report; component scores reflect the available saved results'
                : 'Visual score'}
            </p>
            <hr className="border-[#2a2a2a] border-t-1" />
            <div className="flex justify-between font-mono-data text-sm text-primary">
              <span>VISUAL DESIGN</span><span>{visualDesignScore === null ? 'Unavailable' : `${visualDesignScore}/100`}</span>
            </div>
          </>
        )}

        {showTechnical && (isAuthenticated ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-0.5 pb-1">
              <span className="font-mono-data text-xs text-[#80DEEA] uppercase font-bold tracking-wider">Technical Audit (Lighthouse)</span>
              <span className="font-mono-data text-[10px] text-[#777777]">
                {hasLighthouseScores ? 'Lighthouse category scores' : hasWebVitals ? 'Web Vitals are available; category scores are unavailable' : 'Technical measurements are unavailable'}
              </span>
            </div>
            {([
              ['PERFORMANCE', metrics.performance],
              ['ACCESSIBILITY', metrics.accessibility],
              ['BEST PRACTICES', metrics.bestPractices],
              ['SEO STRUCTURE', metrics.seoStructure],
            ] as const).map(([label, value]) => (
              <div key={label}>
                <div className="flex justify-between font-mono-data text-mono-data mb-1 text-primary"><span>{label}</span><span>{value ?? '—'}</span></div>
                <div className="h-2 progress-bar-bg w-full">
                  {value !== null && <div className="h-full progress-bar-fill" style={{ width: `${value}%` }} />}
                </div>
              </div>
            ))}
            {hasWebVitals && <div className="mt-2 pt-4 border-t border-[#2a2a2a]">
              <div className="font-mono-data text-xs text-[#80DEEA] uppercase mb-3 font-bold">Web Vitals Telemetry</div>
              <div className="grid grid-cols-2 gap-2 font-mono-data text-[11px]">
                {[
                  ['FCP', metrics.firstContentfulPaint], ['LCP', metrics.largestContentfulPaint],
                  ['Speed Index', metrics.speedIndex], ['TBT', metrics.totalBlockingTime], ['TTI', metrics.timeToInteractive],
                ].map(([label, value]) => hasDisplayMetric(value as string | undefined) && (
                  <div key={label} className="bg-[#090909] p-2 border border-[#2a2a2a] flex justify-between">
                    <span className="text-[#888888]">{label}:</span><span className="text-primary font-bold">{value}</span>
                  </div>
                ))}
                {metrics.cumulativeLayoutShift != null && <div className="bg-[#090909] p-2 border border-[#2a2a2a] flex justify-between">
                  <span className="text-[#888888]">CLS:</span><span className="text-primary font-bold">{metrics.cumulativeLayoutShift}</span>
                </div>}
              </div>
            </div>}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center border border-[#2a2a2a] bg-[#090909]">
            <span className="material-symbols-outlined text-2xl text-[#888888] mb-2">lock</span>
            <span className="font-mono-data text-mono-data text-primary uppercase mb-1">Category metrics locked</span>
            <p className="font-body-md text-body-md text-[#888888] mb-4 text-xs">Sign up to unlock detailed technical analysis.</p>
            <Link to="/register" className="tech-button px-4 py-2 font-label-sm text-label-sm uppercase bg-primary text-brand-dark no-underline">SIGN UP</Link>
          </div>
        ))}
      </div>
    </div>
  );
};

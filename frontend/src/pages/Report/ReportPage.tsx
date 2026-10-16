import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchReportById } from '../../services/report.service';
import { ReportData } from '../../types/report';
import { ReportHeader } from '../../components/report/ReportHeader';
import { ScorePanel } from '../../components/report/ScorePanel';
import { QualitativeCritique } from '../../components/report/QualitativeCritique';
import { StrengthsRefinements } from '../../components/report/StrengthsRefinements';
import { StatisticsChart } from '../../components/report/StatisticsChart';
import { useAuth } from '../../contexts/AuthContext';
import { getReportPresentation } from '../../services/report-presentation.js';

export const ReportPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    if (!id) {
      setReport(null);
      setError('Report not found.');
      setLoading(false);
      return;
    }

    fetchReportById(id)
      .then((data) => {
        if (isMounted) {
          setReport(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setReport(null);
          setError('This report could not be found or you do not have access to it.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-container-max mx-auto px-margin-desktop py-stack-lg flex flex-col items-center justify-center min-h-[50vh]">
        <div className="font-mono-data text-primary animate-pulse flex items-center gap-3">
          <span className="animate-spin text-2xl font-bold">⟳</span>
          <span>LOADING FORENSIC REPORT DATA...</span>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="max-w-container-max mx-auto px-margin-desktop py-stack-lg min-h-[50vh] flex items-center justify-center">
        <p className="font-mono-data text-on-surface-variant">{error || 'Report unavailable.'}</p>
      </div>
    );
  }

  const presentation = getReportPresentation(report.status, report.aiStatus);

  return (
    <main className="max-w-container-max mx-auto px-margin-desktop py-stack-lg flex flex-col gap-stack-lg">
      {report.url && (
        <div className="bg-[#101010] border border-[#2a2a2a] px-4 py-2 flex items-center justify-between font-mono-data text-xs text-[#888888]">
          <div className="flex items-center gap-2 truncate">
            <span className="text-[#80DEEA] font-bold">TARGET:</span>
            <span className="text-primary font-mono-data truncate">{report.url}</span>
          </div>
          <span className="text-[#80DEEA] text-[10px] uppercase border border-[#2a2a2a] px-2 py-0.5 whitespace-nowrap">
            {presentation.validated ? 'TARGET VALIDATED' : report.status}
          </span>
        </div>
      )}

      <ReportHeader
        evaluationId={report.evaluationId}
        algorithm={report.algorithm}
        timestamp={report.timestamp}
        latency={report.latency}
      />

      {report.status === 'BLOCKED' || report.status === 'INCONCLUSIVE' ? (
        <div role="status" className="border border-amber-700 bg-amber-950/40 p-4 font-mono-data text-sm text-amber-200">
          <strong>{report.status === 'BLOCKED' ? 'TARGET ACCESS BLOCKED' : 'EVALUATION INCONCLUSIVE'}.</strong>{' '}
          {report.validationReason ?? presentation.targetMessage}
          {presentation.retryAvailable && report.url && <div className="mt-3"><Link className="underline" to={`/analyze?url=${encodeURIComponent(report.url)}`}>Retry analysis</Link></div>}
        </div>
      ) : report.status === 'FAILED' ? (
        <div role="status" className="border border-red-800 bg-red-950/40 p-4 font-mono-data text-sm text-red-200">This analysis failed before a reliable report could be completed.</div>
      ) : null}

      {presentation.aiUnavailable && (
        <div role="status" className="border border-amber-700 bg-amber-950/40 p-4 font-mono-data text-sm text-amber-200">
          AI feedback is unavailable for this report. The scores and Web Vitals below come from Lighthouse; no AI critique or overall score was generated.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter bg-[#2a2a2a] p-gutter">
        <ScorePanel
          overallScore={report.overallScore}
          visualDesignScore={report.visualDesignScore}
          verdictStatus={report.verdictStatus}
          metrics={report.metrics}
          isAuthenticated={isAuthenticated}
        />

        <div className="md:col-span-8 flex flex-col gap-gutter bg-[#2a2a2a] relative">
          {report.status !== 'COMPLETED' ? (
            <div className="border border-[#2a2a2a] bg-[#151515] p-8 text-center font-mono-data text-sm text-[#bbbbbb]">
              No visual evaluation or technical scores are available for this target-page status.
            </div>
          ) : isAuthenticated && report.aiStatus === 'AVAILABLE' ? (
            <>
              <QualitativeCritique critique={report.qualitativeCritique} />
              <StrengthsRefinements strengths={report.strengths} refinements={report.refinements} />
            </>
          ) : report.aiStatus === 'UNAVAILABLE' ? (
            <div className="border border-[#2a2a2a] bg-[#151515] p-8 text-center font-mono-data text-sm text-[#bbbbbb]">
              Qualitative critique and recommendations were not generated because Gemini was unavailable.
            </div>
          ) : (
            <div className="relative border border-[#2a2a2a] bg-[#151515] p-8 flex flex-col items-center justify-center text-center min-h-[380px] overflow-hidden">
              {/* Blurred background preview */}
              <div className="absolute inset-0 opacity-15 blur-sm select-none pointer-events-none p-6 text-left">
                <p className="mb-4">{report.qualitativeCritique[0]}</p>
                <div className="flex gap-4">
                  <div className="w-1/2 h-20 border border-[#2a2a2a] bg-[#090909]"></div>
                  <div className="w-1/2 h-20 border border-[#2a2a2a] bg-[#090909]"></div>
                </div>
              </div>

              {/* Elegant Inline Lock State */}
              <div className="relative z-10 flex flex-col items-center max-w-md p-6 bg-[#090909]/90 border border-[#2a2a2a]">
                <span className="material-symbols-outlined text-4xl text-primary mb-3">lock</span>
                <h3 className="font-headline-md text-headline-md text-primary uppercase mb-2">
                  FULL REPORT LOCKED
                </h3>
                <p className="font-body-md text-body-md text-[#888888] mb-6">
                  Sign up to unlock the complete AI report, qualitative critique, accessibility breakdown, and forensic recommendations.
                </p>
                <div className="flex justify-center w-full">
                  <Link
                    to="/register"
                    className="tech-button px-6 py-3 font-label-sm text-label-sm uppercase bg-primary text-brand-dark no-underline"
                  >
                    SIGN UP
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {isAuthenticated && report.status === 'COMPLETED' ? (
        <StatisticsChart metrics={report.metrics} />
      ) : report.status !== 'COMPLETED' ? (
        <div className="border border-[#2a2a2a] bg-[#151515] p-5 font-mono-data text-sm text-[#888888]">
          Lighthouse telemetry is unavailable because the intended target page was not validated.
        </div>
      ) : (
        <div className="border border-[#2a2a2a] bg-[#151515] p-8 flex flex-col items-center justify-center text-center min-h-[220px]">
          <span className="material-symbols-outlined text-3xl text-[#888888] mb-2">analytics</span>
          <p className="font-mono-data text-mono-data text-[#888888]">
            Detailed telemetry graphs locked. Authenticate to view full forensic statistics.
          </p>
        </div>
      )}
    </main>
  );
};

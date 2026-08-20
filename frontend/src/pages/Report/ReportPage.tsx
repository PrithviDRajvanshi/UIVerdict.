import React, { useEffect, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { fetchReportById } from '../../services/report.service';
import { ReportData } from '../../types/report';
import { ReportHeader } from '../../components/report/ReportHeader';
import { ScorePanel } from '../../components/report/ScorePanel';
import { QualitativeCritique } from '../../components/report/QualitativeCritique';
import { StrengthsRefinements } from '../../components/report/StrengthsRefinements';
import { StatisticsChart } from '../../components/report/StatisticsChart';
import { useAuth } from '../../contexts/AuthContext';

export const ReportPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    if (location.state?.report) {
      setReport(location.state.report);
      setLoading(false);
      return;
    }

    fetchReportById(id || '749-X2')
      .then((data) => {
        if (isMounted) {
          setReport(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [id, location.state]);

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

  if (!report) return null;

  return (
    <main className="max-w-container-max mx-auto px-margin-desktop py-stack-lg flex flex-col gap-stack-lg">
      {report.url && (
        <div className="bg-[#101010] border border-[#2a2a2a] px-4 py-2 flex items-center justify-between font-mono-data text-xs text-[#888888]">
          <div className="flex items-center gap-2 truncate">
            <span className="text-[#80DEEA] font-bold">TARGET:</span>
            <span className="text-primary font-mono-data truncate">{report.url}</span>
          </div>
          <span className="text-[#80DEEA] text-[10px] uppercase border border-[#2a2a2a] px-2 py-0.5 whitespace-nowrap">
            LIVE ANALYZED
          </span>
        </div>
      )}

      <ReportHeader
        evaluationId={report.evaluationId}
        algorithm={report.algorithm}
        timestamp={report.timestamp}
        latency={report.latency}
      />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter bg-[#2a2a2a] p-gutter">
        <ScorePanel
          overallScore={report.overallScore}
          verdictStatus={report.verdictStatus}
          metrics={report.metrics}
          isAuthenticated={isAuthenticated}
        />

        <div className="md:col-span-8 flex flex-col gap-gutter bg-[#2a2a2a] relative">
          {isAuthenticated ? (
            <>
              <QualitativeCritique critique={report.qualitativeCritique} />
              <StrengthsRefinements strengths={report.strengths} refinements={report.refinements} />
            </>
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

      {isAuthenticated ? (
        <StatisticsChart metrics={report.metrics} />
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

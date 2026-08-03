import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchReportById } from '../../services/report.service';
import { ReportData } from '../../types/report';
import { ReportHeader } from '../../components/report/ReportHeader';
import { ScorePanel } from '../../components/report/ScorePanel';
import { QualitativeCritique } from '../../components/report/QualitativeCritique';
import { StrengthsRefinements } from '../../components/report/StrengthsRefinements';
import { StatisticsChart } from '../../components/report/StatisticsChart';

export const ReportPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<ReportData | null>(null);

  useEffect(() => {
    fetchReportById(id || '749-X2').then(setReport);
  }, [id]);

  if (!report) return null;

  return (
    <main className="max-w-container-max mx-auto px-margin-desktop py-stack-lg flex flex-col gap-stack-lg">
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
        />

        <div className="md:col-span-8 flex flex-col gap-gutter bg-[#2a2a2a]">
          <QualitativeCritique critique={report.qualitativeCritique} />
          <StrengthsRefinements strengths={report.strengths} refinements={report.refinements} />
        </div>
      </div>

      <StatisticsChart metrics={report.metrics} />
    </main>
  );
};

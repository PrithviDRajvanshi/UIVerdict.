import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Stage {
  id: string;
  label: string;
  threshold: number; // Progress percentage when completed
}

const STAGES: Stage[] = [
  { id: '1', label: 'URL Validation', threshold: 15 },
  { id: '2', label: 'Launching Browser', threshold: 30 },
  { id: '3', label: 'Capturing Screenshot', threshold: 45 },
  { id: '4', label: 'Running Lighthouse', threshold: 60 },
  { id: '5', label: 'Accessibility Audit', threshold: 75 },
  { id: '6', label: 'AI UI/UX Evaluation', threshold: 90 },
  { id: '7', label: 'Generating Report', threshold: 100 },
];

export const AnalysisPage: React.FC = () => {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + 5;
      });
    }, 200);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (progress >= 100) {
      const timer = setTimeout(() => {
        navigate('/report/749-X2');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [progress, navigate]);

  return (
    <div className="max-w-container-max mx-auto px-margin-desktop py-stack-lg flex flex-col items-center justify-center min-h-[70vh]">
      <div className="w-full max-w-2xl bg-[#151515] border border-[#2a2a2a] p-8 flex flex-col gap-6">
        <div className="flex justify-between items-end border-b border-[#2a2a2a] pb-4">
          <div>
            <span className="font-label-sm text-label-sm text-[#80DEEA] uppercase tracking-widest block mb-1">
              SYSTEM ANALYSIS IN PROGRESS
            </span>
            <h1 className="font-headline-lg text-headline-lg text-primary uppercase">
              FORENSIC SCAN ACTIVE
            </h1>
          </div>
          <div className="text-right">
            <span className="font-mono-data text-2xl font-bold text-primary">{progress}%</span>
          </div>
        </div>

        {/* Progress Bar Container */}
        <div className="w-full h-3 progress-bar-bg border border-[#2a2a2a] overflow-hidden">
          <div
            className="h-full progress-bar-fill transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Live Analysis Progress Stages */}
        <div className="flex flex-col gap-3 mt-2">
          {STAGES.map((stage, idx) => {
            const isCompleted = progress >= stage.threshold;
            const isCurrent = progress < stage.threshold && (idx === 0 || progress >= STAGES[idx - 1].threshold);

            return (
              <div
                key={stage.id}
                className={`flex items-center justify-between p-3 border transition-colors ${
                  isCompleted
                    ? 'border-[#2a2a2a] bg-[#090909] text-primary'
                    : isCurrent
                    ? 'border-primary bg-[#1a1a1a] text-primary'
                    : 'border-[#2a2a2a]/40 bg-[#101010]/50 text-[#64748b]'
                }`}
              >
                <div className="flex items-center gap-3 font-mono-data text-mono-data">
                  {isCompleted ? (
                    <span className="text-[#80DEEA] font-bold">✓</span>
                  ) : isCurrent ? (
                    <span className="animate-spin text-primary">⟳</span>
                  ) : (
                    <span className="text-[#444748]">○</span>
                  )}
                  <span>{stage.label}</span>
                </div>

                <span className="font-label-sm text-[10px] uppercase">
                  {isCompleted ? 'COMPLETE' : isCurrent ? 'RUNNING' : 'PENDING'}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-2 text-center font-mono-data text-xs text-[#888888]">
          Automated analysis window ~60 seconds // Auto-redirecting to report upon completion
        </div>
      </div>
    </div>
  );
};

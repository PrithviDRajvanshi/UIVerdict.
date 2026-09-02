import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { analyzeWebsite, mapBackendToReportData } from '../../services/analysis.service';
import { storeReport } from '../../services/report.service';

interface Stage {
  id: string;
  label: string;
  threshold: number; // Progress percentage when stage begins
}

const STAGES: Stage[] = [
  { id: '1', label: 'Validating Target URL', threshold: 5 },
  { id: '2', label: 'Capturing High-Res Screenshot', threshold: 20 },
  { id: '3', label: 'Auditing Performance & Accessibility', threshold: 50 },
  { id: '4', label: 'Qualitative UI/UX Evaluation', threshold: 75 },
  { id: '5', label: 'Persisting Snapshots & Finalizing Verdict', threshold: 95 },
];

export const AnalysisPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const initialUrl = location.state?.url || searchParams.get('url') || '';
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [urlToAnalyze, setUrlToAnalyze] = useState(initialUrl);

  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasFiredRef = useRef<string | null>(null);

  // Smoothly advance visual progress stage indicators while HTTP request is in-flight
  useEffect(() => {
    if (!loading) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev < 20) return prev + 3;
        if (prev < 50) return prev + 2;
        if (prev < 75) return prev + 1;
        if (prev < 95) return prev + 1;
        return 95; // Hold at 95% until actual backend response resolves
      });
    }, 700);

    return () => {
      clearInterval(interval);
    };
  }, [loading]);

  useEffect(() => {
    if (!urlToAnalyze) return;

    // Prevent duplicate requests for the same URL
    if (hasFiredRef.current === urlToAnalyze) {
      return;
    }

    hasFiredRef.current = urlToAnalyze;

    console.log('[Analysis UI] Starting request for URL:', urlToAnalyze);
    setLoading(true);
    setError(null);
    setProgress(5);

    analyzeWebsite(urlToAnalyze)
      .then((data) => {
        console.log('[Analysis UI] Response received:', data);

        const reportData = mapBackendToReportData(data);
        console.log('[Analysis UI] Parsed report data:', reportData);
        storeReport(reportData);

        // Transition to 100% completion state
        setProgress(100);
        setLoading(false);
        hasFiredRef.current = null;

        console.log('[Analysis UI] Navigating to report:', reportData.evaluationId);
        navigate(`/report/${reportData.evaluationId}`, { state: { report: reportData } });
      })
      .catch((err) => {
        console.error('[Analysis UI] Request failed:', err);
        hasFiredRef.current = null;

        setLoading(false);
        setError(err?.message || 'Unable to analyze this website right now. Please try again.');
      });
  }, [urlToAnalyze, navigate]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const trimmed = inputUrl.trim();
    if (!trimmed) {
      setError('Please enter a valid website URL.');
      return;
    }

    let validUrl = trimmed;
    if (!/^https?:\/\//i.test(validUrl)) {
      validUrl = `https://${validUrl}`;
    }

    try {
      new URL(validUrl);
    } catch {
      setError('Please enter a valid website URL.');
      return;
    }

    hasFiredRef.current = null;
    setError(null);
    setUrlToAnalyze(validUrl);
  };

  return (
    <div className="max-w-container-max mx-auto px-margin-desktop py-stack-lg flex flex-col items-center justify-center min-h-[70vh]">
      <div className="w-full max-w-2xl bg-[#151515] border border-[#2a2a2a] p-8 flex flex-col gap-6">
        
        {(!urlToAnalyze || error) && (
          <div className="flex flex-col gap-4">
            <div>
              <span className="font-label-sm text-label-sm text-[#80DEEA] uppercase tracking-widest block mb-1">
                UIVERDICT ANALYSIS PIPELINE
              </span>
              <h1 className="font-headline-lg text-headline-lg text-primary uppercase">
                {error ? 'ANALYSIS ERROR' : 'ENTER URL FOR SCAN'}
              </h1>
            </div>

            {error && (
              <div className="p-4 bg-red-950/70 border border-red-800 text-red-300 font-mono-data text-sm flex items-start gap-3">
                <span className="material-symbols-outlined text-red-400 mt-0.5">error</span>
                <div className="flex-1">
                  <div className="font-bold uppercase text-xs mb-1 text-red-400">Analysis Failed</div>
                  <div>{error}</div>
                </div>
              </div>
            )}

            <form onSubmit={handleManualSubmit} className="flex flex-col md:flex-row gap-2 w-full mt-2">
              <input
                className="flex-grow bg-[#090909] border border-[#2a2a2a] font-body-md text-primary px-4 py-3 outline-none focus:border-primary"
                placeholder="https://example.com"
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !inputUrl.trim()}
                className="px-6 py-3 bg-primary text-brand-dark font-headline-md uppercase tracking-wider hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
              >
                {loading ? 'ANALYZING...' : 'ANALYZE NOW'}
              </button>
            </form>
          </div>
        )}

        {urlToAnalyze && !error && (
          <>
            <div className="flex justify-between items-end border-b border-[#2a2a2a] pb-4">
              <div>
                <span className="font-label-sm text-label-sm text-[#80DEEA] uppercase tracking-widest block mb-1">
                  SYSTEM ANALYSIS IN PROGRESS
                </span>
                <h1 className="font-headline-lg text-headline-lg text-primary uppercase">
                  FORENSIC SCAN ACTIVE
                </h1>
                <p className="font-mono-data text-xs text-[#888888] mt-1 truncate max-w-md">
                  Target: {urlToAnalyze}
                </p>
              </div>
              <div className="text-right">
                <span className="font-mono-data text-2xl font-bold text-primary">{progress}%</span>
              </div>
            </div>

            {/* Progress Bar Container */}
            <div className="w-full h-3 progress-bar-bg border border-[#2a2a2a] overflow-hidden">
              <div
                className="h-full progress-bar-fill transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Live Analysis Progress Stages */}
            <div className="flex flex-col gap-3 mt-2">
              {STAGES.map((stage, idx) => {
                const isCompleted = idx < STAGES.length - 1 ? progress >= STAGES[idx + 1].threshold : progress === 100;
                const isCurrent = !isCompleted && (idx === 0 || progress >= STAGES[idx].threshold);

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
              Automated analysis in progress // Auto-redirecting to report upon completion
            </div>
          </>
        )}
      </div>
    </div>
  );
};

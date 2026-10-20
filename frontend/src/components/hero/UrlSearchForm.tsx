import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_ANALYSIS_MODE, OVERALL_MODE_ENABLED, OVERALL_MODE_TOOLTIP } from '../../services/analysis-mode.js';

export type SelectedAnalysisMode = 'visual' | 'tech';

export const UrlSearchForm: React.FC = () => {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<SelectedAnalysisMode>(DEFAULT_ANALYSIS_MODE);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = url.trim();
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

    const params = new URLSearchParams({ url: validUrl, mode });
    navigate(`/analysis?${params.toString()}`, { state: { url: validUrl, mode } });
  };

  return (
    <div className="w-full max-w-2xl mt-8 relative">
      <div role="group" aria-label="Analysis mode" className="flex items-center justify-center gap-2 mb-3 font-mono-data text-xs">
        <button type="button" aria-pressed={mode === 'visual'} onClick={() => setMode('visual')}
          className={`px-4 py-2 border ${mode === 'visual' ? 'border-primary text-primary' : 'border-brand-border text-[#888888]'}`}>
          VISUAL
        </button>
        <button type="button" aria-pressed={mode === 'tech'} onClick={() => setMode('tech')}
          className={`px-4 py-2 border ${mode === 'tech' ? 'border-primary text-primary' : 'border-brand-border text-[#888888]'}`}>
          TECHNICAL
        </button>
        <div className="flex items-center gap-1">
          <button type="button" disabled={!OVERALL_MODE_ENABLED} aria-disabled={!OVERALL_MODE_ENABLED} title={OVERALL_MODE_TOOLTIP}
            className="px-4 py-2 border border-[#333333] text-[#555555] opacity-50 cursor-not-allowed">
            OVERALL
          </button>
          <details className="relative">
            <summary aria-label="Why overall analysis is unavailable" title="About overall analysis"
              className="list-none cursor-pointer w-6 h-6 rounded-full border border-[#666666] text-[#aaaaaa] flex items-center justify-center">i</summary>
            <div role="note" className="absolute z-20 right-0 top-8 w-64 p-3 text-left normal-case bg-[#101010] border border-brand-border text-[#cccccc] shadow-xl">
              {OVERALL_MODE_TOOLTIP}
            </div>
          </details>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col md:flex-row w-full bg-[#101010] border border-brand-border shadow-2xl">
        <div className="flex-grow relative flex items-center border-b md:border-b-0 md:border-r border-brand-border focus-within:border-primary transition-colors">
          <span aria-hidden="true" className="material-symbols-outlined text-outline ml-4">
            link
          </span>
          <input
            className="w-full bg-transparent border-none font-body-md text-body-md text-primary placeholder:text-outline-variant focus:ring-0 px-4 py-4 outline-none"
            placeholder="https://example.com"
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
          />
        </div>
        <button
          className="px-8 py-4 bg-brand-dark hover:bg-primary hover:text-brand-dark text-primary font-headline-md text-headline-md uppercase tracking-wider transition-colors duration-200 border-none flex items-center justify-center group whitespace-nowrap cursor-pointer"
          type="submit"
        >
          ANALYZE
          <span aria-hidden="true" className="material-symbols-outlined ml-2 group-hover:translate-x-1 transition-transform">
            arrow_forward
          </span>
        </button>
      </form>
      {error && (
        <div className="mt-3 p-3 bg-red-950/80 border border-red-800 text-red-300 font-mono-data text-xs flex items-center gap-2">
          <span className="material-symbols-outlined text-sm text-red-400">error</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

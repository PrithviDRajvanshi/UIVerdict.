import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const UrlSearchForm: React.FC = () => {
  const [url, setUrl] = useState('');
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

    navigate('/analysis', { state: { url: validUrl } });
  };

  return (
    <div className="w-full max-w-2xl mt-8 relative">
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

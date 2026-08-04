import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const UrlSearchForm: React.FC = () => {
  const [url, setUrl] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url) {
      navigate('/analysis');
    }
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
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
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
    </div>
  );
};

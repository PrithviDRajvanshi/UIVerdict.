import React, { useState } from 'react';
import { ProfileCard } from './ProfileCard';

interface FilterSidebarProps {
  selectedStatus: string;
  onSelectStatus: (status: string) => void;
}

export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  selectedStatus,
  onSelectStatus,
}) => {
  return (
    <aside className="w-full md:w-64 bg-[#141313] border-r border-border-color flex flex-col p-4 gap-6 shrink-0 text-[#f5f5f5]">
      <ProfileCard />

      {/* Research Parameters */}
      <div>
        <div className="font-label-sm text-label-sm text-on-surface-variant mb-2 pb-1 border-b border-border-color uppercase">
          Research Parameters
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              defaultChecked
              className="tech-input form-checkbox h-4 w-4 text-primary bg-[#0e0e0e] border-border-color focus:ring-0"
              type="checkbox"
            />
            <span className="font-body-md text-body-md text-on-surface group-hover:text-primary transition-colors">
              Heuristic Analysis
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              defaultChecked
              className="tech-input form-checkbox h-4 w-4 text-primary bg-[#0e0e0e] border-border-color focus:ring-0"
              type="checkbox"
            />
            <span className="font-body-md text-body-md text-on-surface group-hover:text-primary transition-colors">
              Accessibility
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              className="tech-input form-checkbox h-4 w-4 text-primary bg-[#0e0e0e] border-border-color focus:ring-0"
              type="checkbox"
            />
            <span className="font-body-md text-body-md text-on-surface group-hover:text-primary transition-colors">
              Performance
            </span>
          </label>
        </div>
      </div>

      {/* Status Filters */}
      <div>
        <div className="font-label-sm text-label-sm text-on-surface-variant mb-2 pb-1 border-b border-border-color uppercase">
          Status Filters
        </div>
        <div className="flex flex-wrap gap-2">
          {['ALL', 'COMPLETE', 'FAILED', 'PENDING'].map((st) => (
            <button
              key={st}
              onClick={() => onSelectStatus(st)}
              className={`tech-chip font-label-sm text-label-sm cursor-pointer ${
                selectedStatus === st ? 'active' : 'hover:text-primary hover:border-primary'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto pt-6 border-t border-border-color">
        <button className="tech-button w-full py-2 font-label-sm text-label-sm flex items-center justify-center gap-2 cursor-pointer">
          <span className="material-symbols-outlined text-sm">download</span>
          EXPORT LOG
        </button>
      </div>
    </aside>
  );
};

import React from 'react';
import { ProfileCard } from './ProfileCard';

interface FilterSidebarProps {
  selectedStatus: string;
  onSelectStatus: (status: string) => void;
  onExportLog?: () => void;
}

export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  selectedStatus,
  onSelectStatus,
  onExportLog,
}) => {
  return (
    <aside className="w-full md:w-64 bg-[#141313] border-r border-border-color flex flex-col p-4 gap-6 shrink-0 text-[#f5f5f5]">
      <ProfileCard />

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
        <button
          onClick={onExportLog}
          className="tech-button w-full py-2 font-label-sm text-label-sm flex items-center justify-center gap-2 cursor-pointer hover:bg-primary hover:text-brand-dark transition-colors"
        >
          <span className="material-symbols-outlined text-sm">download</span>
          EXPORT LOG
        </button>
      </div>
    </aside>
  );
};

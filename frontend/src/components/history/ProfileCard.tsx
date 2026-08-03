import React from 'react';

export const ProfileCard: React.FC = () => {
  return (
    <div className="border border-border-color bg-[#141313] p-4">
      <div className="flex items-center gap-3 mb-3 border-b border-border-color pb-3">
        <div className="w-10 h-10 border border-primary flex items-center justify-center bg-[#090909]">
          <span className="material-symbols-outlined text-primary">person</span>
        </div>
        <div>
          <div className="font-headline-md text-headline-md text-primary">Dr. A. Turing</div>
          <div className="font-mono-data text-mono-data text-on-surface-variant">Lead Analyst</div>
        </div>
      </div>
      <div className="flex justify-between items-center font-mono-data text-mono-data">
        <span className="text-on-surface-variant">ID:</span>
        <span className="text-primary">#UV-9942</span>
      </div>
    </div>
  );
};

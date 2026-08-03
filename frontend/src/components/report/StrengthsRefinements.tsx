import React from 'react';

interface StrengthsRefinementsProps {
  strengths: string[];
  refinements: string[];
}

export const StrengthsRefinements: React.FC<StrengthsRefinementsProps> = ({
  strengths,
  refinements,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter h-full">
      {/* Strengths */}
      <div className="bg-[#151515] border border-[#2a2a2a] p-6 h-full">
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[#f5f5f5] text-lg">check_box</span>
          <h3 className="font-headline-md text-headline-md uppercase text-primary">Strengths</h3>
        </div>
        <ul className="font-mono-data text-mono-data text-[#888888] flex flex-col gap-3">
          {strengths.map((item, idx) => (
            <li
              key={idx}
              className={`flex items-start gap-2 ${
                idx < strengths.length - 1 ? 'border-b border-[#2a2a2a] pb-2' : ''
              }`}
            >
              <span className="material-symbols-outlined text-[14px] mt-[2px]">arrow_right</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Areas for Refinement */}
      <div className="bg-[#151515] border border-[#2a2a2a] p-6 h-full">
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[#f5f5f5] text-lg">warning</span>
          <h3 className="font-headline-md text-headline-md uppercase text-primary">Areas for Refinement</h3>
        </div>
        <ul className="font-mono-data text-mono-data text-[#888888] flex flex-col gap-3">
          {refinements.map((item, idx) => (
            <li
              key={idx}
              className={`flex items-start gap-2 ${
                idx < refinements.length - 1 ? 'border-b border-[#2a2a2a] pb-2' : ''
              }`}
            >
              <span className="material-symbols-outlined text-[14px] mt-[2px]">arrow_right</span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

import React from 'react';

interface QualitativeCritiqueProps {
  critique: string[];
}

export const QualitativeCritique: React.FC<QualitativeCritiqueProps> = ({ critique }) => {
  return (
    <div className="bg-[#151515] border border-[#2a2a2a] flex-grow">
      <div className="border-b border-[#2a2a2a] p-4 flex justify-between items-center">
        <h2 className="font-headline-md text-headline-md uppercase text-primary">AI UX/UI Evaluation & Critique</h2>
        <span className="font-mono-data text-[10px] text-[#80DEEA] uppercase tracking-wider">Holistic Review</span>
      </div>
      <div className="p-6 font-body-md text-body-md leading-relaxed text-[#888888]">
        {critique.map((paragraph, index) => (
          <p key={index} className={index < critique.length - 1 ? 'mb-4' : ''}>
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
};

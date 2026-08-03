import React from 'react';

interface QualitativeCritiqueProps {
  critique: string[];
}

export const QualitativeCritique: React.FC<QualitativeCritiqueProps> = ({ critique }) => {
  return (
    <div className="bg-[#151515] border border-[#2a2a2a] flex-grow">
      <div className="border-b border-[#2a2a2a] p-4">
        <h2 className="font-headline-md text-headline-md uppercase text-primary">Qualitative Critique</h2>
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

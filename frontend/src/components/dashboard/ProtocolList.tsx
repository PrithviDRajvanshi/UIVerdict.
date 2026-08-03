import React from 'react';
import { ProtocolItem } from '../../types/analysis';

interface ProtocolListProps {
  protocols: ProtocolItem[];
}

export const ProtocolList: React.FC<ProtocolListProps> = ({ protocols }) => {
  return (
    <section className="w-full bg-[#101010] border-y border-brand-border py-16">
      <div className="max-w-container-max mx-auto px-margin-desktop">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 border-r border-brand-border pr-8">
            <h2 className="font-headline-lg text-headline-lg text-primary uppercase mb-4">System Protocol</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Our proprietary engine deconstructs interfaces into measurable data points, applying heuristic evaluation models at scale.
            </p>
          </div>
          <div className="lg:col-span-8 flex flex-col gap-4">
            {protocols.map((proto, idx) => (
              <div
                key={idx}
                className="border border-brand-border bg-[#151515] p-6 flex flex-col md:flex-row gap-6 items-start hover:border-outline-variant transition-colors"
              >
                <div className="w-12 h-12 flex-shrink-0 border border-brand-border flex items-center justify-center bg-brand-dark text-primary font-headline-md text-headline-md">
                  {proto.number}
                </div>
                <div>
                  <h3 className="font-headline-md text-headline-md text-primary mb-2 uppercase">{proto.title}</h3>
                  <p className="font-body-md text-body-md text-on-surface-variant">{proto.description}</p>
                  <div className="mt-4 flex gap-2">
                    {proto.tags.map((t, i) => (
                      <span key={i} className="font-mono-data text-mono-data text-outline-variant border border-brand-border px-2 py-0.5">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

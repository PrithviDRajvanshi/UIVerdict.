import React from 'react';

export const ShaderBackground: React.FC = () => {
  return (
    <div className="absolute inset-0 w-full h-full z-0 opacity-20 pointer-events-none">
      <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="smallGrid" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M 8 0 L 0 0 0 8" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          </pattern>
          <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <rect width="80" height="80" fill="url(#smallGrid)" />
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <path d="M 0 100 Q 250 50 500 100 T 1000 100" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" className="opacity-50" />
        <path d="M 0 150 Q 300 200 600 150 T 1200 150" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" className="opacity-30" />
      </svg>
    </div>
  );
};

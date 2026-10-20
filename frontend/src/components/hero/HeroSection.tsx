import React from 'react';
import { ShaderBackground } from './ShaderBackground';
import { UrlSearchForm } from './UrlSearchForm';

export const HeroSection: React.FC = () => {
  return (
    <section className="relative w-full min-h-[calc(100vh-73px)] flex flex-col items-center justify-center border-b border-brand-border overflow-hidden px-margin-desktop bg-grid-pattern">
      <ShaderBackground />
      <div className="relative z-10 w-full max-w-4xl mx-auto flex flex-col items-center text-center space-y-stack-lg py-12">
        <h1 className="font-display-lg text-display-lg text-primary tracking-tight max-w-3xl">
          SEE WHAT USERS SEE.
        </h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">
          Analyze any website using AI and receive detailed UI, UX, accessibility and usability reports.
        </p>
        <UrlSearchForm />
      </div>
    </section>
  );
};

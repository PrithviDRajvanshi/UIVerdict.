import React from 'react';
import { Link } from 'react-router-dom';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-surface dark:bg-surface border-t border-outline-variant full-width bottom mt-auto">
      <div className="flex flex-col md:flex-row justify-between items-center w-full px-margin-desktop py-stack-lg max-w-container-max mx-auto gap-4">
        <div className="font-headline-md text-headline-md font-bold text-primary dark:text-primary">
          © UIVerdict SPEC V1.0.4
        </div>
        <div className="flex flex-wrap justify-center gap-6">
          <a className="text-on-surface-variant font-label-sm text-label-sm hover:text-primary underline transition-all duration-200" href="#">
            PRIVACY
          </a>
          <a className="text-on-surface-variant font-label-sm text-label-sm hover:text-primary underline transition-all duration-200" href="#">
            TERMS
          </a>
          <a className="text-on-surface-variant font-label-sm text-label-sm hover:text-primary underline transition-all duration-200" href="#">
            METHODOLOGY
          </a>
          <a className="text-on-surface-variant font-label-sm text-label-sm hover:text-primary underline transition-all duration-200" href="#">
            DATA ETHICS
          </a>
          <a className="text-on-surface-variant font-label-sm text-label-sm hover:text-primary underline transition-all duration-200" href="#">
            API
          </a>
        </div>
      </div>
    </footer>
  );
};

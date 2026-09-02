import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-surface dark:bg-surface border-t border-outline-variant full-width bottom mt-auto">
      <div className="flex flex-col md:flex-row justify-between items-center w-full px-margin-desktop py-stack-lg max-w-container-max mx-auto gap-4">
        <div className="font-headline-md text-headline-md font-bold text-primary dark:text-primary">
          © UIVerdict 1.0.0
        </div>
      </div>
    </footer>
  );
};


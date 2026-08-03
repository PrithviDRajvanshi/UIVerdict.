import React from 'react';
import { Link } from 'react-router-dom';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-margin-desktop text-center">
      <h1 className="font-display-lg text-display-lg text-primary mb-4">404 // RESOURCE UNRESOLVED</h1>
      <p className="font-body-lg text-body-lg text-[#888888] max-w-md mb-8">
        The requested path or evaluation matrix does not exist on this node.
      </p>
      <Link to="/" className="tech-button px-6 py-3 font-headline-md text-headline-md uppercase no-underline">
        RETURN TO SYSTEM ROOT
      </Link>
    </div>
  );
};

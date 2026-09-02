import React from 'react';
import { useAuth } from '../../contexts/AuthContext';

export const ProfileCard: React.FC = () => {
  const { user } = useAuth();

  if (!user) return null;

  const shortId = user.id ? `#UV-${user.id.substring(0, 6).toUpperCase()}` : '#UV-USER';

  return (
    <div className="border border-border-color bg-[#141313] p-4">
      <div className="flex items-center gap-3 mb-3 border-b border-border-color pb-3">
        <div className="w-10 h-10 border border-primary flex items-center justify-center bg-[#090909]">
          <span className="material-symbols-outlined text-primary">person</span>
        </div>
        <div className="overflow-hidden">
          <div className="font-headline-md text-headline-md text-primary truncate">{user.name}</div>
          <div className="font-mono-data text-mono-data text-on-surface-variant truncate">{user.email}</div>
        </div>
      </div>
      <div className="flex justify-between items-center font-mono-data text-mono-data">
        <span className="text-on-surface-variant">ANALYST ID:</span>
        <span className="text-primary">{shortId}</span>
      </div>
    </div>
  );
};

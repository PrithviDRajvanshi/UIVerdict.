import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export const Navbar: React.FC = () => {
  const location = useLocation();
  const { isAuthenticated, logout } = useAuth();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="bg-transparent border-b border-outline-variant full-width top-0 z-50 sticky backdrop-blur-sm">
      <div className="flex justify-between items-center w-full px-margin-desktop py-4 max-w-container-max mx-auto">
        <Link to="/" className="font-headline-md text-headline-md font-bold tracking-tighter text-primary no-underline">
          UIVerdict
        </Link>
        <div className="hidden md:flex items-center space-x-8">
          <Link
            to="/"
            className={`font-label-sm text-label-sm transition-colors duration-200 ${
              isActive('/') || isActive('/analysis')
                ? 'text-primary font-bold border-b border-primary pb-1'
                : 'text-on-surface-variant font-normal hover:text-primary'
            }`}
          >
            ANALYZE
          </Link>
          <Link
            to="/report/749-X2"
            className={`font-label-sm text-label-sm transition-colors duration-200 ${
              isActive('/report/749-X2') || location.pathname.startsWith('/report') || isActive('/saved-reports')
                ? 'text-primary font-bold border-b border-primary pb-1'
                : 'text-on-surface-variant font-normal hover:text-primary'
            }`}
          >
            REPORTS
          </Link>
          <Link
            to="/archive"
            className={`font-label-sm text-label-sm transition-colors duration-200 ${
              isActive('/archive') || isActive('/history')
                ? 'text-primary font-bold border-b border-primary pb-1'
                : 'text-on-surface-variant font-normal hover:text-primary'
            }`}
          >
            ARCHIVE
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <button
              onClick={logout}
              className="tech-button font-label-sm text-label-sm px-4 py-2 hover:bg-primary hover:text-brand-dark transition-colors duration-200 uppercase tracking-widest bg-brand-dark text-primary cursor-pointer"
            >
              LOG OUT
            </button>
          ) : (
            <Link
              to="/register"
              className="tech-button font-label-sm text-label-sm px-4 py-2 hover:bg-primary hover:text-brand-dark transition-colors duration-200 uppercase tracking-widest bg-primary text-brand-dark no-underline"
            >
              SIGN UP
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
};

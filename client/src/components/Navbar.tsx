import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

export function Navbar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const pathParts = location.pathname.split('/');
  const videoId = (pathParts[1] === 'editor' || pathParts[1] === 'export') ? pathParts[2] : null;

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const navLinks = (
    <>
      <Link
        to="/"
        onClick={() => setMobileOpen(false)}
        className={`text-xs font-bold uppercase tracking-wide transition-colors ${
          isActive('/') && !isActive('/editor') && !isActive('/export')
            ? 'text-red-hot'
            : 'text-white-dim hover:text-orange-accent'
        }`}
      >
        Dashboard
      </Link>
      {videoId && (
        <>
          <Link
            to={`/editor/${videoId}`}
            onClick={() => setMobileOpen(false)}
            className={`text-xs font-bold uppercase tracking-wide transition-colors ${
              isActive('/editor') ? 'text-red-hot' : 'text-white-dim hover:text-orange-accent'
            }`}
          >
            Editor
          </Link>
          <Link
            to={`/export/${videoId}`}
            onClick={() => setMobileOpen(false)}
            className={`text-xs font-bold uppercase tracking-wide transition-colors ${
              isActive('/export') ? 'text-red-hot' : 'text-white-dim hover:text-orange-accent'
            }`}
          >
            Export
          </Link>
        </>
      )}
    </>
  );

  return (
    <nav className="bg-black-deep border-b-2 border-red-hot px-4 py-3">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-red-hot text-xl font-bold tracking-tight shrink-0">
            refrAIm
          </Link>
          <div className="hidden md:flex items-center gap-6">
            {navLinks}
          </div>
        </div>

        {/* Platform chrome (Hub, user email, sign-out) moved to AppNav */}

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'Close section navigation' : 'Open section navigation'}
          aria-expanded={mobileOpen}
          aria-controls="refraim-section-navigation"
          className="md:hidden min-h-11 min-w-11 flex items-center justify-center text-white-dim hover:text-red-hot transition-colors"
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div id="refraim-section-navigation" className="md:hidden mt-3 pt-3 border-t border-border-subtle space-y-3">
          <div className="flex flex-col gap-3">
            {navLinks}
          </div>
          {/* Platform chrome (Hub, user email, sign-out) moved to AppNav */}
        </div>
      )}

    </nav>
  );
}

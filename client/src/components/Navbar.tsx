import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Menu, X } from 'lucide-react';

export function Navbar() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    if (!window.confirm('Sign out?')) return;
    try {
      await signOut();
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

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
          <Link to="/" className="text-red-hot text-xl font-bold uppercase tracking-tight shrink-0">
            REFRAIM
          </Link>
          <div className="hidden md:flex items-center gap-6">
            {navLinks}
          </div>
        </div>

        {/* Desktop user controls */}
        {user && (
          <div className="hidden md:flex items-center gap-4">
            <span className="text-white-dim text-xs truncate max-w-[200px]">{user.email}</span>
            <button
              onClick={handleLogout}
              className="bg-red-hot text-white px-4 py-2 text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all shrink-0"
            >
              Logout
            </button>
          </div>
        )}

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden text-white-dim hover:text-red-hot transition-colors"
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden mt-3 pt-3 border-t border-border-subtle space-y-3">
          <div className="flex flex-col gap-3">
            {navLinks}
          </div>
          {user && (
            <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
              <span className="text-white-dim text-xs truncate">{user.email}</span>
              <button
                onClick={handleLogout}
                className="bg-red-hot text-white px-4 py-2 text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all shrink-0"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

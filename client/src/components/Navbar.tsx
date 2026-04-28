import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Menu, X, LogOut } from 'lucide-react';

const GATEWAY_URL =
  (import.meta.env.VITE_GATEWAY_URL as string | undefined) || 'https://www.aiden.services';

export function Navbar() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogout = () => signOut();

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

        {user && (
          <div className="hidden md:flex items-center gap-4">
            <a
              href={`${GATEWAY_URL}/dashboard`}
              className="text-xs font-bold uppercase tracking-wide text-white-dim hover:text-orange-accent transition-colors"
            >
              &larr; Hub
            </a>
            <span className="text-white-dim text-xs truncate max-w-[200px]">{user.email}</span>
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="bg-red-hot text-white px-4 py-2 text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all shrink-0"
            >
              Sign Out
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
              <a
                href={`${GATEWAY_URL}/dashboard`}
                className="text-xs font-bold uppercase tracking-wide text-white-dim hover:text-orange-accent transition-colors"
              >
                &larr; Hub
              </a>
              <span className="text-white-dim text-xs truncate">{user.email}</span>
              <button
                onClick={() => { setShowLogoutConfirm(true); setMobileOpen(false); }}
                className="bg-red-hot text-white px-4 py-2 text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all shrink-0"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      )}

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-black-card border-2 border-red-hot p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <LogOut className="w-5 h-5 text-red-hot shrink-0" />
              <h3 className="text-white-full font-bold uppercase text-sm">Sign Out</h3>
            </div>
            <p className="text-white-muted text-sm mb-6">Are you sure you want to sign out?</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 text-xs font-bold text-white-muted uppercase tracking-wide border border-border-subtle hover:border-white-dim transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowLogoutConfirm(false); handleLogout(); }}
                className="px-4 py-2 text-xs font-bold text-white uppercase tracking-wide bg-red-hot border-2 border-red-hot hover:bg-red-dim transition-all"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

import { Link, useLocation } from 'react-router-dom';

export function Navbar() {
  const location = useLocation();

  const pathParts = location.pathname.split('/');
  const videoId = (pathParts[1] === 'editor' || pathParts[1] === 'export') ? pathParts[2] : null;

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const navLinks = (
    <>
      <Link
        to="/"
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
            className={`text-xs font-bold uppercase tracking-wide transition-colors ${
              isActive('/editor') ? 'text-red-hot' : 'text-white-dim hover:text-orange-accent'
            }`}
          >
            Editor
          </Link>
          <Link
            to={`/export/${videoId}`}
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
    <nav className="hidden md:block bg-black-deep border-b border-border-subtle px-4 py-3" aria-label="refrAIm section navigation">
      <div className="max-w-7xl mx-auto flex items-center">
        <div className="flex items-center gap-6">
          {navLinks}
        </div>
      </div>
    </nav>
  );
}

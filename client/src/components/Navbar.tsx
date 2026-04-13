import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function Navbar() {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const handleLogout = async () => {
    if (!window.confirm('Sign out?')) return;
    try {
      await signOut();
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  // Extract videoId from path if on editor/export routes
  const pathParts = location.pathname.split('/');
  const videoId = (pathParts[1] === 'editor' || pathParts[1] === 'export') ? pathParts[2] : null;

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <nav className="bg-black-deep border-b-2 border-red-hot px-4 py-3">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-red-hot text-xl font-bold uppercase tracking-tight">
            REFRAIM
          </Link>
          <div className="flex items-center gap-6">
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
          </div>
        </div>
        {user && (
          <div className="flex items-center gap-4">
            <span className="text-white-dim text-xs">{user.email}</span>
            <button
              onClick={handleLogout}
              className="bg-red-hot text-white px-4 py-2 text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

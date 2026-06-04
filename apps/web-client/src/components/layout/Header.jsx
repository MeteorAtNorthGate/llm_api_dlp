/** Header component — app top bar with user info and theme toggle. */

import { useAuth } from '../../hooks/useAuth';
import Button from '../ui/Button';

export default function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="navbar bg-base-100 border-b border-base-300 px-4 shadow-sm">
      <div className="flex-1">
        <a href="/" className="text-xl font-bold tracking-tight">
          LLM Platform
        </a>
      </div>
      <div className="flex-none gap-2">
        {user && (
          <div className="dropdown dropdown-end">
            <label tabIndex={0} className="btn btn-ghost btn-sm gap-2">
              <div className="avatar placeholder">
                <div className="bg-neutral text-neutral-content rounded-full w-8">
                  <span className="text-xs">
                    {user.preferred_username?.[0]?.toUpperCase() || 'U'}
                  </span>
                </div>
              </div>
              <span className="hidden sm:inline">{user.preferred_username || user.email}</span>
            </label>
            <ul tabIndex={0} className="dropdown-content z-10 menu p-2 shadow bg-base-100 rounded-box w-52 mt-2">
              <li className="menu-title">
                <span>{user.email}</span>
              </li>
              <li>
                <a href="/admin">API Keys</a>
              </li>
              <li>
                <button onClick={logout}>Logout</button>
              </li>
            </ul>
          </div>
        )}
      </div>
    </header>
  );
}

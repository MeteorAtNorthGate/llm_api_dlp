/** Header component — app top bar with user info and theme toggle. */

import { useAuth } from '../../hooks/useAuth';
import Button from '../ui/Button';

export default function Header() {
  const { user, logout } = useAuth();

  const groups = user?.groups || [];
  const isAdmin = groups.includes('admins');
  const isDeveloper = groups.includes('developers');

  return (
    <header className="navbar bg-base-100 border-b border-base-300 px-4 shadow-sm">
      <div className="flex-1">
        <a href="/" className="text-xl font-bold tracking-tight">
          LLM Platform
        </a>
        <div className="hidden sm:flex ml-6 gap-1">
          <a href="/" className="btn btn-ghost btn-sm">Chat</a>
          {isDeveloper && (
            <a href="/admin" className="btn btn-ghost btn-sm">API Keys</a>
          )}
          {isAdmin && (
            <a href="/api-providers" className="btn btn-ghost btn-sm text-primary">API Providers</a>
          )}
          {isAdmin && (
            <a href="/ldap" className="btn btn-ghost btn-sm text-primary">LDAP</a>
          )}
          {isAdmin && (
            <a href="/statistics" className="btn btn-ghost btn-sm text-primary">Statistics</a>
          )}
          <a href="/usage" className="btn btn-ghost btn-sm">Usage</a>
        </div>
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
              <li><a href="/">Chat</a></li>
              {isDeveloper && <li><a href="/admin">API Keys</a></li>}
              {isAdmin && <li><a href="/api-providers">API Providers</a></li>}
              {isAdmin && <li><a href="/ldap">LDAP Configuration</a></li>}
              {isAdmin && <li><a href="/statistics">Statistics</a></li>}
              <li><a href="/usage">Usage</a></li>
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

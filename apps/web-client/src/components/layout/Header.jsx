/** Header component — app top bar with user info and language toggle. */

import { useAuth } from '../../hooks/useAuth';
import useT from '../../hooks/useT';
import SettingsMenu from '../ui/SettingsMenu';
import { Link, NavLink } from 'react-router-dom';
import { Lock } from '../ui/Icons';

export default function Header({ showSidebar = false, sidebarOpen = false, onToggleSidebar }) {
  const { user, logout } = useAuth();
  const t = useT();

  const groups = user?.groups || [];
  const isAdmin = groups.includes('admins');
  const isDeveloper = groups.includes('developers');

  return (
    <header className="app-header navbar bg-base-100 border-b border-base-300 px-4 shadow-sm">
      <div className="flex-1 min-w-0">
        {showSidebar && (
          <button
            type="button"
            className="sidebar-toggle btn btn-ghost btn-sm btn-square"
            aria-label={t('nav.conversations')}
            aria-expanded={sidebarOpen}
            aria-controls="conversation-sidebar"
            onClick={onToggleSidebar}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <Link to="/" className="app-brand text-xl font-bold tracking-tight shrink-0">
          <span className="app-brand-mark" aria-hidden="true"><Lock size={19} /></span>
          {t('app.title')}
        </Link>
        <nav className="app-nav hidden sm:flex ml-6 gap-1" aria-label={t('nav.main')}>
          <NavLink to="/" end className="btn btn-ghost btn-sm">{t('nav.chat')}</NavLink>
          {isDeveloper && (
            <NavLink to="/admin" className="btn btn-ghost btn-sm">{t('nav.apiKeys')}</NavLink>
          )}
          {isAdmin && (
            <NavLink to="/api-providers" className="btn btn-ghost btn-sm text-primary">{t('nav.apiProviders')}</NavLink>
          )}
          {isAdmin && (
            <NavLink to="/ldap" className="btn btn-ghost btn-sm text-primary">{t('nav.ldap')}</NavLink>
          )}
          {isAdmin && (
            <NavLink to="/statistics" className="btn btn-ghost btn-sm text-primary">{t('nav.statistics')}</NavLink>
          )}
          <NavLink to="/usage" className="btn btn-ghost btn-sm">{t('nav.usage')}</NavLink>
        </nav>
      </div>
      <div className="flex-none gap-2">
        <SettingsMenu />
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
              <li><a href="/">{t('nav.chat')}</a></li>
              {isDeveloper && <li><a href="/admin">{t('nav.apiKeys')}</a></li>}
              {isAdmin && <li><a href="/api-providers">{t('nav.apiProviders')}</a></li>}
              {isAdmin && <li><a href="/ldap">{t('nav.ldap')}</a></li>}
              {isAdmin && <li><a href="/statistics">{t('nav.statistics')}</a></li>}
              <li><a href="/usage">{t('nav.usage')}</a></li>
              <li>
                <button onClick={logout}>{t('nav.logout')}</button>
              </li>
            </ul>
          </div>
        )}
      </div>
    </header>
  );
}

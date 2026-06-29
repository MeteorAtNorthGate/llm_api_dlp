/** Header component — app top bar with user info and language toggle. */

import { useAuth } from '../../hooks/useAuth';
import useT from '../../hooks/useT';
import LanguageToggle from '../ui/LanguageToggle';

export default function Header() {
  const { user, logout } = useAuth();
  const t = useT();

  const groups = user?.groups || [];
  const isAdmin = groups.includes('admins');
  const isDeveloper = groups.includes('developers');

  return (
    <header className="navbar bg-base-100 border-b border-base-300 px-4 shadow-sm">
      <div className="flex-1">
        <a href="/" className="text-xl font-bold tracking-tight">
          {t('app.title')}
        </a>
        <div className="hidden sm:flex ml-6 gap-1">
          <a href="/" className="btn btn-ghost btn-sm">{t('nav.chat')}</a>
          {isDeveloper && (
            <a href="/admin" className="btn btn-ghost btn-sm">{t('nav.apiKeys')}</a>
          )}
          {isAdmin && (
            <a href="/api-providers" className="btn btn-ghost btn-sm text-primary">{t('nav.apiProviders')}</a>
          )}
          {isAdmin && (
            <a href="/ldap" className="btn btn-ghost btn-sm text-primary">{t('nav.ldap')}</a>
          )}
          {isAdmin && (
            <a href="/statistics" className="btn btn-ghost btn-sm text-primary">{t('nav.statistics')}</a>
          )}
          <a href="/usage" className="btn btn-ghost btn-sm">{t('nav.usage')}</a>
        </div>
      </div>
      <div className="flex-none gap-2">
        <LanguageToggle />
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

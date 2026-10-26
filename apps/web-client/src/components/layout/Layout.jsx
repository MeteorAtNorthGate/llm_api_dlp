/** Layout — main app layout with sidebar and header. */

import Header from './Header';
import Sidebar from './Sidebar';
import VersionBadge from './VersionBadge';
import { useState } from 'react';
import useT from '../../hooks/useT';

export default function Layout({ children, showSidebar = true }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const t = useT();
  return (
    <div className="app-shell flex flex-col h-screen">
      <Header showSidebar={showSidebar} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((open) => !open)} />
      <div className="app-workspace flex flex-1 min-h-0 overflow-hidden">
        {showSidebar && (
          <>
            {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label={t('common.close')} />}
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          </>
        )}
        <main className="app-main flex-1 h-full min-w-0 flex flex-col overflow-clip">{children}</main>
      </div>
      <VersionBadge />
    </div>
  );
}

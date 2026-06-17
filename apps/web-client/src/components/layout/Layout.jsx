/** Layout — main app layout with sidebar and header. */

import Header from './Header';
import Sidebar from './Sidebar';

export default function Layout({ children, showSidebar = true }) {
  return (
    <div className="flex flex-col h-screen">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {showSidebar && <Sidebar />}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

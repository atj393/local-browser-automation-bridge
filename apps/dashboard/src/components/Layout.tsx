import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

export function Layout({ children }: { children: ReactNode }) {
  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Local Browser<br />Automation Bridge</h1>
        <nav>
          <NavLink to="/" end className={navClass}>Dashboard</NavLink>
          <NavLink to="/settings" className={navClass}>Settings</NavLink>
          <NavLink to="/profile" className={navClass}>Personal Profile</NavLink>
          <NavLink to="/queue" className={navClass}>Queue</NavLink>
          <NavLink to="/logs" className={navClass}>Logs</NavLink>
        </nav>
        <div style={{ marginTop: 24, fontSize: 11, color: '#7e8294', lineHeight: 1.5 }}>
          v0.1.0<br />
          Local prototype.<br />
          Auto-submit defaults off.
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

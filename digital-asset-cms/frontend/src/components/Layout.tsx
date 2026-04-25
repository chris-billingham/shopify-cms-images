import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { useAlertStore } from '../stores/alertStore';
import { usePermissions } from '../hooks/usePermissions';
import { apiClient } from '../api/client';
import { useWebSocket } from '../hooks/useWebSocket';
import { WebSocketMessage } from '../types';

export function Layout({ children }: { children: React.ReactNode }) {
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const role = useAuthStore((s) => s.role);
  const accessToken = useAuthStore((s) => s.accessToken);
  const { canViewAdmin } = usePermissions();
  const navigate = useNavigate();

  const driveWatcherAlert = useAlertStore((s) => s.driveWatcherAlert);
  const rateLimitAlert = useAlertStore((s) => s.rateLimitAlert);
  const setDriveWatcherAlert = useAlertStore((s) => s.setDriveWatcherAlert);

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // ignore — clear local auth regardless
    }
    clearAuth();
    navigate('/login', { replace: true });
  };

  const { data: me } = useQuery({
    queryKey: ['users', 'me'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ user: { name: string; email: string; role: string; avatar_url: string | null } }>('/users/me');
      return data.user;
    },
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });

  useQuery({
    queryKey: ['drive', 'watcher-status'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ paused: boolean; consecutiveFailures: number }>('/drive/watcher-status');
      return data;
    },
    enabled: role === 'admin',
    refetchInterval: 60_000,
    staleTime: 30_000,
    select: (data) => {
      if (data.paused) {
        setDriveWatcherAlert(`Drive watcher has paused after ${data.consecutiveFailures} consecutive failures. Check the server logs and restart the service.`);
      }
      return data;
    },
  });

  const handleWsMessage = (msg: WebSocketMessage) => {
    if (msg.type === 'admin_alert') {
      const payload = msg.payload as { message?: string } | undefined;
      setDriveWatcherAlert(payload?.message ?? 'Drive watcher alert');
    }
  };
  useWebSocket(handleWsMessage, role === 'admin');

  const displayName = me?.name ?? role ?? '';
  const initials = displayName
    .split(' ')
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase() || (role ?? 'U').slice(0, 2).toUpperCase();

  const avatarEl = me?.avatar_url ? (
    <img src={me.avatar_url} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  ) : (
    initials
  );

  const alertBanners = (
    <>
      {driveWatcherAlert && (
        <div style={{
          background: '#fff3cd',
          border: '1.5px solid var(--ink)',
          borderTop: 'none',
          padding: '8px 18px',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          fontFamily: "'Architects Daughter', sans-serif",
        }}>
          <span>⚠ {driveWatcherAlert}</span>
          <button
            onClick={() => setDriveWatcherAlert(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--ink)', lineHeight: 1, padding: '0 4px' }}
            aria-label="Dismiss alert"
          >
            ×
          </button>
        </div>
      )}
      {rateLimitAlert && (
        <div style={{
          background: 'var(--accent-soft)',
          border: '1.5px solid var(--accent)',
          borderTop: 'none',
          padding: '6px 18px',
          fontSize: 12,
          color: 'var(--accent)',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {rateLimitAlert}
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', fontFamily: "'Architects Daughter', sans-serif" }}>

      {/* Desktop nav — hidden on mobile via CSS */}
      <nav className="desktop-nav-bar" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 18px',
        borderBottom: '2px solid var(--ink)',
        background: 'var(--paper)',
        position: 'sticky',
        top: 0,
        zIndex: 30,
      }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{
            fontFamily: "'Caveat', cursive",
            fontWeight: 700,
            fontSize: 20,
            marginRight: 14,
            color: 'var(--ink)',
          }}>
            ◼ Asset CMS
          </span>
          <NavLink to="/" end style={navItemStyle}>Library</NavLink>
          <NavLink to="/upload" style={navItemStyle}>Upload</NavLink>
          <NavLink to="/products" style={navItemStyle}>Products</NavLink>
          {canViewAdmin && (
            <NavLink to="/admin" style={navItemStyle}>Admin</NavLink>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' }}>
          <Link to="/profile" style={{
            width: 28, height: 28,
            border: '1.5px solid var(--ink)',
            borderRadius: '50%',
            background: 'var(--accent-soft)',
            display: 'grid',
            placeItems: 'center',
            fontFamily: "'Caveat', cursive",
            fontWeight: 700,
            fontSize: 14,
            flexShrink: 0,
            overflow: 'hidden',
            textDecoration: 'none',
            color: 'var(--ink)',
          }}>
            {avatarEl}
          </Link>
          <Link to="/profile" style={{ lineHeight: 1.2, textAlign: 'right', textDecoration: 'none', color: 'var(--ink)' }}>
            <div style={{ fontSize: 13 }}>{displayName}</div>
            {me?.email && (
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>
                {me.email}
              </div>
            )}
          </Link>
          <button onClick={handleLogout} className="btn-sketch sm">
            log out
          </button>
        </div>
      </nav>

      {/* Mobile slim top bar — hidden on desktop via CSS */}
      <nav className="mobile-slim-nav" style={{
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '2px solid var(--ink)',
        background: 'var(--paper)',
        position: 'sticky',
        top: 0,
        zIndex: 30,
      }}>
        <span style={{
          fontFamily: "'Caveat', cursive",
          fontWeight: 700,
          fontSize: 20,
          color: 'var(--ink)',
        }}>
          ◼ Asset CMS
        </span>
        <Link to="/profile" style={{
          width: 32, height: 32,
          border: '1.5px solid var(--ink)',
          borderRadius: '50%',
          background: 'var(--accent-soft)',
          display: 'grid',
          placeItems: 'center',
          fontFamily: "'Caveat', cursive",
          fontWeight: 700,
          fontSize: 15,
          flexShrink: 0,
          overflow: 'hidden',
          textDecoration: 'none',
          color: 'var(--ink)',
        }}>
          {avatarEl}
        </Link>
      </nav>

      {alertBanners}

      <main className="flex-1 layout-main">
        {children}
      </main>

      {/* Mobile bottom tab bar — always in DOM, hidden on desktop via CSS */}
      <nav className="mobile-tab-bar" aria-label="Main navigation">
        <NavLink to="/" end className={({ isActive }) => `mobile-tab${isActive ? ' active' : ''}`}>
          <span className="mobile-tab-icon">▣</span>
          Library
        </NavLink>
        <NavLink to="/upload" className={({ isActive }) => `mobile-tab${isActive ? ' active' : ''}`}>
          <span className="mobile-tab-icon">↑</span>
          Upload
        </NavLink>
        <NavLink to="/products" className={({ isActive }) => `mobile-tab${isActive ? ' active' : ''}`}>
          <span className="mobile-tab-icon">⬡</span>
          Products
        </NavLink>
        {canViewAdmin && (
          <NavLink to="/admin" className={({ isActive }) => `mobile-tab${isActive ? ' active' : ''}`}>
            <span className="mobile-tab-icon">⚙</span>
            Admin
          </NavLink>
        )}
        <button className="mobile-tab" onClick={handleLogout} aria-label="Log out">
          <span className="mobile-tab-icon">←</span>
          Log out
        </button>
      </nav>
    </div>
  );
}

function navItemStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
  return {
    padding: '5px 12px',
    border: isActive ? '1.5px solid var(--ink)' : '1.5px solid transparent',
    background: isActive ? 'var(--yellow-soft)' : 'transparent',
    fontSize: 14,
    cursor: 'pointer',
    textDecoration: 'none',
    color: 'var(--ink)',
    transform: isActive ? 'rotate(-0.8deg)' : 'none',
    display: 'inline-block',
    fontFamily: "'Architects Daughter', sans-serif",
    whiteSpace: 'nowrap',
  };
}

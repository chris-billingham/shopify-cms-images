import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { usePermissions } from '../hooks/usePermissions';
import { apiClient } from '../api/client';

export function Layout({ children }: { children: React.ReactNode }) {
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const role = useAuthStore((s) => s.role);
  const accessToken = useAuthStore((s) => s.accessToken);
  const { canViewAdmin } = usePermissions();
  const navigate = useNavigate();

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
      const { data } = await apiClient.get<{ user: { name: string; email: string; role: string } }>('/users/me');
      return data.user;
    },
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  });

  const displayName = me?.name ?? role ?? '';
  const initials = displayName
    .split(' ')
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase() || (role ?? 'U').slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', fontFamily: "'Architects Daughter', sans-serif" }}>
      <nav style={{
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
          <div style={{
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
          }}>
            {initials}
          </div>
          <div style={{ lineHeight: 1.2, textAlign: 'right' }}>
            <div style={{ fontSize: 13 }}>{displayName}</div>
            {me?.email && (
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace" }}>
                {me.email}
              </div>
            )}
          </div>
          <button onClick={handleLogout} className="btn-sketch sm">
            log out
          </button>
        </div>
      </nav>

      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}

// NavLink style function — receives { isActive }
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

import { useState, useEffect, Component, ReactNode } from 'react';
import axios from 'axios';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/LoginPage';
import { Layout } from './components/Layout';
import { AssetLibrary } from './components/AssetLibrary';
import { AssetDetailPanel } from './components/AssetDetailPanel';
import { UploadView } from './components/UploadView';
import { ProductBrowser } from './components/ProductBrowser';
import { AdminSettings } from './components/AdminSettings';
import { useAuthStore } from './stores/authStore';
import { usePermissions } from './hooks/usePermissions';
import { Asset } from './types';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24 }}>
          <div style={{
            border: '1.5px solid var(--accent)',
            background: 'var(--accent-soft)',
            padding: '12px 16px',
            fontSize: 13,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            <strong>Something went wrong.</strong>
            <pre style={{ marginTop: 8, fontSize: 11, whiteSpace: 'pre-wrap' }}>
              {(this.state.error as Error).message}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ marginTop: 8, cursor: 'pointer', fontSize: 12, textDecoration: 'underline', background: 'none', border: 'none' }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

// Attempts a silent token refresh on mount so page reloads don't bounce to login.
// Shows nothing while the attempt is in flight, then either restores the session
// or renders children (which will redirect to /login if still unauthenticated).
function AuthInitializer({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const setRole = useAuthStore((s) => s.setRole);

  useEffect(() => {
    axios.post('/api/auth/refresh', {}, { withCredentials: true })
      .then(({ data }) => {
        setAccessToken(data.accessToken);
        try {
          const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
          setRole(payload.role);
        } catch { /* ignore */ }
      })
      .catch(() => { /* no valid session — routes will redirect */ })
      .finally(() => setReady(true));
  }, [setAccessToken, setRole]);

  if (!ready) return null;
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <Navigate to="/login" replace />;
  return <Layout><ErrorBoundary>{children}</ErrorBoundary></Layout>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { canViewAdmin } = usePermissions();
  if (!accessToken) return <Navigate to="/login" replace />;
  if (!canViewAdmin) return <Navigate to="/" replace />;
  return <Layout><ErrorBoundary>{children}</ErrorBoundary></Layout>;
}

function App() {
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthInitializer>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <div className="p-6">
                  <AssetLibrary onAssetClick={setSelectedAsset} />
                </div>
                {selectedAsset && (
                  <AssetDetailPanel asset={selectedAsset} onClose={() => setSelectedAsset(null)} />
                )}
              </ProtectedRoute>
            }
          />
          <Route
            path="/upload"
            element={
              <ProtectedRoute>
                <UploadView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/products"
            element={
              <ProtectedRoute>
                <div className="p-6">
                  <ProductBrowser />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <div className="p-6">
                  <AdminSettings />
                </div>
              </AdminRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </AuthInitializer>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;

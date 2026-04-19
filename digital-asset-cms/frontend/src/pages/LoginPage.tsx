import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const setRole = useAuthStore((s) => s.setRole);
  const navigate = useNavigate();

  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google';
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const { data } = await axios.post(
        '/api/auth/login',
        { email, password },
        { withCredentials: true },
      );
      setAccessToken(data.accessToken);
      try {
        const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
        setRole(payload.role);
      } catch { /* ignore */ }
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error ?? 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      display: 'grid',
      placeItems: 'center',
      minHeight: '100vh',
      background: 'var(--paper)',
      padding: '20px',
    }}>
      <div style={{
        width: 380,
        maxWidth: '100%',
        padding: 32,
        background: '#fff',
        border: '2.5px solid var(--ink)',
        boxShadow: '6px 6px 0 var(--shadow)',
        transform: 'rotate(-0.5deg)',
      }}>
        <h2 style={{
          fontFamily: "'Caveat', cursive",
          fontSize: 32,
          margin: '0 0 20px',
          textAlign: 'center',
          color: 'var(--ink)',
        }}>
          Digital Asset CMS
        </h2>

        {error && (
          <div role="alert" style={{
            padding: '8px 12px',
            background: 'var(--accent-soft)',
            border: '1.5px solid var(--accent)',
            fontSize: 13,
            color: 'var(--ink)',
            marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        {/* Google OAuth */}
        <button
          onClick={handleGoogleLogin}
          className="btn-sketch"
          style={{ width: '100%', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>

        {/* Divider */}
        <div style={{
          textAlign: 'center',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: 'var(--ink-soft)',
          margin: '14px 0',
          position: 'relative',
        }}>
          <span style={{
            background: '#fff',
            padding: '0 8px',
            position: 'relative',
            zIndex: 1,
          }}>or</span>
          <div style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            right: 0,
            height: 1,
            background: 'var(--ink-soft)',
            zIndex: 0,
          }} />
        </div>

        {/* Email / password */}
        <form onSubmit={handleEmailLogin}>
          <label style={{ fontSize: 13, color: 'var(--ink-soft)', display: 'block', marginBottom: 2 }}>
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="sketch-input"
            style={{ marginBottom: 12 }}
          />

          <label style={{ fontSize: 13, color: 'var(--ink-soft)', display: 'block', marginBottom: 2 }}>
            Password
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="sketch-input"
            style={{ marginBottom: 16 }}
          />

          <button
            type="submit"
            disabled={isLoading}
            className="btn-sketch primary"
            style={{ width: '100%', textAlign: 'center' }}
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--ink-soft)' }}>
          forgot password? · contact your admin
        </div>
      </div>
    </div>
  );
}

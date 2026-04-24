import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';

type Me = {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar_url: string | null;
  has_password: boolean;
  created_at: string;
};

const cardStyle: React.CSSProperties = {
  border: '1.5px solid var(--ink)',
  background: 'var(--paper)',
  padding: '16px 20px',
  marginBottom: 16,
  boxShadow: '2px 2px 0 var(--ink)',
};

const sectionHeadStyle: React.CSSProperties = {
  fontFamily: "'Caveat', cursive",
  fontSize: 18,
  fontWeight: 700,
  color: 'var(--ink)',
  marginBottom: 12,
  marginTop: 0,
};

export function ProfilePage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: me, isLoading } = useQuery({
    queryKey: ['users', 'me'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ user: Me }>('/users/me');
      return data.user;
    },
    staleTime: 5 * 60 * 1000,
  });

  const [name, setName] = useState('');
  const [nameStatus, setNameStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwStatus, setPwStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pwError, setPwError] = useState('');

  const [avatarStatus, setAvatarStatus] = useState<'idle' | 'uploading' | 'error'>('idle');

  useEffect(() => {
    if (me?.name) setName(me.name);
  }, [me?.name]);

  const saveName = async () => {
    if (!name.trim() || name.trim() === me?.name) return;
    setNameStatus('saving');
    try {
      await apiClient.patch('/users/me', { name: name.trim() });
      queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
      setNameStatus('saved');
      setTimeout(() => setNameStatus('idle'), 2000);
    } catch {
      setNameStatus('error');
    }
  };

  const uploadAvatar = async (file: File) => {
    setAvatarStatus('uploading');
    const formData = new FormData();
    formData.append('file', file);
    try {
      await apiClient.post('/users/me/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
      setAvatarStatus('idle');
    } catch {
      setAvatarStatus('error');
      setTimeout(() => setAvatarStatus('idle'), 3000);
    }
  };

  const changePassword = async () => {
    setPwError('');
    if (newPw !== confirmPw) {
      setPwError('New passwords do not match');
      return;
    }
    if (newPw.length < 8) {
      setPwError('Password must be at least 8 characters');
      return;
    }
    setPwStatus('saving');
    try {
      await apiClient.post('/users/me/password', { currentPassword: currentPw, newPassword: newPw });
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setPwStatus('saved');
      setTimeout(() => setPwStatus('idle'), 2500);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? 'Password change failed';
      setPwError(message);
      setPwStatus('error');
    }
  };

  if (isLoading) {
    return <div style={{ padding: 40, fontFamily: "'Architects Daughter', sans-serif", color: 'var(--ink)' }}>loading…</div>;
  }
  if (!me) return null;

  const initials = me.name
    .split(' ')
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'U';

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: '0 20px', fontFamily: "'Architects Daughter', sans-serif" }}>
      <h1 style={{ fontFamily: "'Caveat', cursive", fontSize: 28, marginBottom: 24, color: 'var(--ink)', marginTop: 0 }}>
        my profile
      </h1>

      {/* Avatar */}
      <section style={cardStyle}>
        <h2 style={sectionHeadStyle}>profile image</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarStatus === 'uploading'}
            title="click to upload a photo"
            style={{
              width: 72,
              height: 72,
              border: '2px solid var(--ink)',
              borderRadius: '50%',
              background: 'var(--accent-soft)',
              display: 'grid',
              placeItems: 'center',
              cursor: avatarStatus === 'uploading' ? 'wait' : 'pointer',
              padding: 0,
              overflow: 'hidden',
              flexShrink: 0,
              position: 'relative',
            }}
          >
            {me.avatar_url ? (
              <img
                src={me.avatar_url}
                alt={me.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: avatarStatus === 'uploading' ? 0.5 : 1 }}
              />
            ) : (
              <span style={{ fontFamily: "'Caveat', cursive", fontSize: 28, fontWeight: 700, color: 'var(--ink)' }}>
                {avatarStatus === 'uploading' ? '…' : initials}
              </span>
            )}
          </button>
          <div>
            {avatarStatus === 'error' ? (
              <p style={{ fontSize: 13, color: 'var(--accent)', margin: 0 }}>upload failed — try again</p>
            ) : avatarStatus === 'uploading' ? (
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>uploading…</p>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0, marginBottom: 4 }}>click to upload a new photo</p>
            )}
            <p style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: "'JetBrains Mono', monospace", margin: 0, marginTop: 4 }}>
              jpg · png · webp — resized to 256×256
            </p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadAvatar(file);
            e.target.value = '';
          }}
        />
      </section>

      {/* Display name */}
      <section style={cardStyle}>
        <h2 style={sectionHeadStyle}>display name</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setNameStatus('idle'); }}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
            className="sketch-input"
            style={{ flex: 1 }}
            placeholder="Your name"
          />
          <button
            onClick={saveName}
            disabled={nameStatus === 'saving' || !name.trim() || name.trim() === me.name}
            className="btn-sketch sm"
          >
            {nameStatus === 'saving' ? 'saving…' : nameStatus === 'saved' ? 'saved ✓' : nameStatus === 'error' ? 'error' : 'save'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 8, marginBottom: 0, fontFamily: "'JetBrains Mono', monospace" }}>
          {me.email} · {me.role}
        </p>
      </section>

      {/* Password — only for email/password accounts */}
      {me.has_password && (
        <section style={cardStyle}>
          <h2 style={sectionHeadStyle}>change password</h2>
          {pwError && (
            <div style={{
              border: '1.5px solid var(--accent)',
              background: 'var(--accent-soft)',
              padding: '6px 10px',
              fontSize: 13,
              marginBottom: 10,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {pwError}
            </div>
          )}
          {pwStatus === 'saved' && (
            <div style={{
              border: '1.5px solid var(--ink)',
              background: 'var(--yellow-soft)',
              padding: '6px 10px',
              fontSize: 13,
              marginBottom: 10,
            }}>
              password updated ✓
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => { setCurrentPw(e.target.value); setPwError(''); setPwStatus('idle'); }}
              placeholder="current password"
              className="sketch-input"
            />
            <input
              type="password"
              value={newPw}
              onChange={(e) => { setNewPw(e.target.value); setPwError(''); setPwStatus('idle'); }}
              placeholder="new password"
              className="sketch-input"
            />
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => { setConfirmPw(e.target.value); setPwError(''); setPwStatus('idle'); }}
              placeholder="confirm new password"
              className="sketch-input"
              onKeyDown={(e) => e.key === 'Enter' && changePassword()}
            />
            <div>
              <button
                onClick={changePassword}
                disabled={pwStatus === 'saving' || !currentPw || !newPw || !confirmPw}
                className="btn-sketch sm"
              >
                {pwStatus === 'saving' ? 'saving…' : 'update password'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

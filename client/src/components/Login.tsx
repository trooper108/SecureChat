import React, { useState } from 'react';
import { CHAT_URL, AUTH_URL } from '../config';
import { getOrCreateIdentity } from '../crypto/keyStore';
import { uploadPublicKey } from '../services/api';
import { SessionManager } from '../services/sessionManager';

export interface AuthState {
  token: string;
  userId: string;
  chatUrl: string;
  authUrl: string;
  sessionManager: SessionManager;
}

interface LoginProps {
  onLogin: (state: AuthState) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [tokenInput, setTokenInput] = useState('');
  const [chatUrl, setChatUrl] = useState(CHAT_URL);
  const [authUrl, setAuthUrl] = useState(AUTH_URL);
  const [userIdInput, setUserIdInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper to parse JWT payload without external library
  function parseJwt(token: string): any {
    try {
      const parts = token.trim().split('.');
      if (parts.length < 2) return null;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  }

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    setTokenInput(val);
    const payload = parseJwt(val);
    if (payload && (payload.sub || payload.userId || payload.id)) {
      setUserIdInput(payload.sub || payload.userId || payload.id);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const token = tokenInput.trim();
    if (!token) {
      setError('Please provide a JWT access token issued by your Auth Service.');
      return;
    }

    const payload = parseJwt(token);
    const userId = userIdInput.trim() || payload?.sub || payload?.userId || payload?.id;

    if (!userId) {
      setError('Could not extract user ID from token payload. Please specify your User ID.');
      return;
    }

    setLoading(true);

    try {
      // 1. Get or generate ECDH P-256 key pair stored in IndexedDB (non-extractable)
      const identity = await getOrCreateIdentity(userId);

      // 2. Upload public key to backend user directory
      await uploadPublicKey(token, identity.publicKeyJwk, chatUrl);

      // 3. Initialize Session Manager
      const sessionManager = new SessionManager(
        identity.privateKey,
        identity.publicKeyJwk,
        token,
        chatUrl
      );

      onLogin({
        token,
        userId,
        chatUrl,
        authUrl,
        sessionManager
      });
    } catch (err: any) {
      setError(err.message || 'Authentication or key exchange failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="logo-header">
          <div className="shield-icon">🛡️</div>
          <h1>SecureChat</h1>
          <p className="subtitle">End-to-End Encrypted Real-time 1-to-1 Messaging</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="token">JWT Access Token (from Auth Service)</label>
            <textarea
              id="token"
              rows={4}
              placeholder="Paste Bearer JWT token issued by your Auth Service..."
              value={tokenInput}
              onChange={handleTokenChange}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="userId">User ID (Subject)</label>
            <input
              id="userId"
              type="text"
              placeholder="e.g. alice_123"
              value={userIdInput}
              onChange={(e) => setUserIdInput(e.target.value)}
              required
            />
            <small className="help-text">
              Auto-detected from token <code>sub</code> or specified manually.
            </small>
          </div>

          <div className="settings-row">
            <div className="form-group">
              <label htmlFor="chatUrl">Chat Server URL</label>
              <input
                id="chatUrl"
                type="text"
                value={chatUrl}
                onChange={(e) => setChatUrl(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="authUrl">Auth Service URL</label>
              <input
                id="authUrl"
                type="text"
                value={authUrl}
                onChange={(e) => setAuthUrl(e.target.value)}
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Initializing E2EE Keys...' : 'Enter SecureChat'}
          </button>
        </form>

        <div className="security-notice">
          <strong>Security Guarantee:</strong>
          <ul>
            <li>ECDH P-256 key pair generated directly in browser</li>
            <li>Private key stays non-extractable in IndexedDB</li>
            <li>Only public key JWK is uploaded to the directory</li>
            <li>Messages encrypted with fresh AES-GCM 12-byte IV</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';

export interface DisplayMessage {
  id: string;
  from: string;
  to: string;
  plaintext: string;
  ciphertext: string;
  iv: string;
  createdAt: string;
  deliveredAt: string | null;
  decryptionFailed?: boolean;
}

interface ChatWindowProps {
  currentUserId: string;
  peerId: string;
  isPeerOnline: boolean;
  isPeerTyping: boolean;
  safetyNumber: string | null;
  messages: DisplayMessage[];
  loadingHistory: boolean;
  error: string | null;
  onSendMessage: (text: string) => Promise<void>;
  onTypingStart: () => void;
  onTypingStop: () => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  currentUserId,
  peerId,
  isPeerOnline,
  isPeerTyping,
  safetyNumber,
  messages,
  loadingHistory,
  error,
  onSendMessage,
  onTypingStart,
  onTypingStop
}) => {
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isPeerTyping]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    // Typing debounce
    onTypingStart();
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      onTypingStop();
    }, 1500);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || sending) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    onTypingStop();

    setSending(true);
    setInputText('');
    try {
      await onSendMessage(text);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <main className="chat-window">
      {/* Chat Header */}
      <header className="chat-header">
        <div className="peer-meta">
          <div className="avatar peer-avatar">
            {peerId.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="peer-title">
              <h2>{peerId}</h2>
              <span className={`status-pill ${isPeerOnline ? 'online' : 'offline'}`}>
                {isPeerOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="e2ee-tag">🔒 End-to-End Encrypted</div>
          </div>
        </div>

        {/* Safety Number Button */}
        <div className="header-actions">
          <button
            className="btn-safety"
            onClick={() => setShowSafetyModal(true)}
            title="Verify Safety Number"
          >
            🛡️ Safety Number
          </button>
        </div>
      </header>

      {/* Safety Number Modal */}
      {showSafetyModal && (
        <div className="modal-overlay" onClick={() => setShowSafetyModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Safety Number Verification</h3>
              <button
                className="btn-close"
                onClick={() => setShowSafetyModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Compare this safety number with <strong>{peerId}</strong> out of band
                (e.g., in person or via voice call) to verify end-to-end encryption.
              </p>
              <div className="safety-number-box">
                {safetyNumber || 'Generating fingerprint...'}
              </div>
              <small className="help-text">
                This fingerprint is computed from both public keys using SHA-256. If
                they match, no man-in-the-middle can read your messages.
              </small>
            </div>
          </div>
        </div>
      )}

      {/* Error alert banner */}
      {error && <div className="alert alert-error chat-alert">{error}</div>}

      {/* Message History List */}
      <div className="messages-container">
        {loadingHistory ? (
          <div className="loading-state">Decrypting chat history...</div>
        ) : messages.length === 0 ? (
          <div className="empty-chat-state">
            <div className="empty-icon">🔐</div>
            <h3>No messages yet</h3>
            <p>
              Messages with <strong>{peerId}</strong> are end-to-end encrypted with
              ECDH &amp; AES-GCM. The server never decrypts them.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.from === currentUserId;
            return (
              <div
                key={msg.id}
                className={`message-bubble-wrapper ${isMe ? 'outgoing' : 'incoming'}`}
              >
                <div
                  className={`message-bubble ${
                    msg.decryptionFailed ? 'decryption-failed' : ''
                  }`}
                >
                  <div className="message-text">{msg.plaintext}</div>
                  <div className="message-meta">
                    <span className="message-time">{formatTime(msg.createdAt)}</span>
                    {isMe && (
                      <span className="delivery-status" title={msg.deliveredAt ? `Delivered at ${msg.deliveredAt}` : 'Stored on server until recipient reconnects'}>
                        {msg.deliveredAt ? '✓✓' : '🕒 Queued'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Typing indicator */}
        {isPeerTyping && (
          <div className="message-bubble-wrapper incoming">
            <div className="message-bubble typing-bubble">
              <span className="typing-dots">
                <span />
                <span />
                <span />
              </span>
              <span className="typing-label">{peerId} is typing...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Message Input Box */}
      <form onSubmit={handleSend} className="message-input-bar">
        <input
          type="text"
          placeholder={`Message ${peerId} (End-to-End Encrypted)...`}
          value={inputText}
          onChange={handleInputChange}
          disabled={sending}
          autoFocus
        />
        <button
          type="submit"
          className="btn btn-send"
          disabled={!inputText.trim() || sending}
        >
          {sending ? '...' : 'Send'}
        </button>
      </form>
    </main>
  );
};

import React, { useState } from 'react';

export interface PeerItem {
  peerId: string;
  isOnline: boolean;
  lastMessage?: string;
  lastTime?: string;
  unreadCount?: number;
}

interface UserListProps {
  currentUserId: string;
  peers: PeerItem[];
  selectedPeerId: string | null;
  onSelectPeer: (peerId: string) => void;
  onLogout: () => void;
}

export const UserList: React.FC<UserListProps> = ({
  currentUserId,
  peers,
  selectedPeerId,
  onSelectPeer,
  onLogout
}) => {
  const [newPeerInput, setNewPeerInput] = useState('');

  const handleStartChat = (e: React.FormEvent) => {
    e.preventDefault();
    const target = newPeerInput.trim();
    if (!target) return;
    if (target === currentUserId) {
      alert('You cannot start a chat with yourself.');
      return;
    }
    onSelectPeer(target);
    setNewPeerInput('');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="user-profile">
          <div className="avatar user-avatar">
            {currentUserId.slice(0, 2).toUpperCase()}
          </div>
          <div className="user-info">
            <span className="user-id" title={currentUserId}>
              {currentUserId}
            </span>
            <span className="status-badge online">
              <span className="dot" /> online
            </span>
          </div>
        </div>
        <button onClick={onLogout} className="btn-icon" title="Logout">
          🚪
        </button>
      </div>

      <div className="new-chat-section">
        <form onSubmit={handleStartChat} className="new-chat-form">
          <input
            type="text"
            placeholder="Enter peer user ID to chat..."
            value={newPeerInput}
            onChange={(e) => setNewPeerInput(e.target.value)}
          />
          <button type="submit" className="btn-small">
            Chat
          </button>
        </form>
      </div>

      <div className="contacts-list">
        <div className="contacts-header">Conversations</div>
        {peers.length === 0 ? (
          <div className="empty-contacts">
            No active chats yet. Enter a peer ID above to start chatting with E2EE.
          </div>
        ) : (
          peers.map((peer) => {
            const isSelected = peer.peerId === selectedPeerId;
            return (
              <div
                key={peer.peerId}
                className={`contact-item ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectPeer(peer.peerId)}
              >
                <div className="avatar">
                  {peer.peerId.slice(0, 2).toUpperCase()}
                  <span
                    className={`presence-dot ${peer.isOnline ? 'online' : 'offline'}`}
                    title={peer.isOnline ? 'Online' : 'Offline'}
                  />
                </div>
                <div className="contact-details">
                  <div className="contact-top">
                    <span className="contact-name">{peer.peerId}</span>
                    {peer.lastTime && (
                      <span className="contact-time">{peer.lastTime}</span>
                    )}
                  </div>
                  <div className="contact-preview">
                    <span className="preview-text">
                      {peer.lastMessage || 'End-to-end encrypted'}
                    </span>
                    {peer.unreadCount ? (
                      <span className="unread-badge">{peer.unreadCount}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};

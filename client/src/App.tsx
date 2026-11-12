import React, { useState, useEffect, useCallback } from 'react';
import { Login, AuthState } from './components/Login';
import { UserList, PeerItem } from './components/UserList';
import { ChatWindow, DisplayMessage } from './components/ChatWindow';
import { initSocket, closeSocket, getSocket } from './services/socket';
import { getChatHistory } from './services/api';

export const App: React.FC = () => {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [messagesMap, setMessagesMap] = useState<Record<string, DisplayMessage[]>>({});
  const [peersMap, setPeersMap] = useState<Record<string, PeerItem>>({});
  const [typingMap, setTypingMap] = useState<Record<string, boolean>>({});
  const [safetyNumbers, setSafetyNumbers] = useState<Record<string, string>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Initialize socket on login
  useEffect(() => {
    if (!auth) return;

    const socket = initSocket(auth.chatUrl, auth.token);

    // Incoming real-time message
    socket.on('message:new', async (data: any) => {
      const { id, from, to, ciphertext, iv, createdAt, deliveredAt } = data;
      const peerId = from === auth.userId ? to : from;

      // Decrypt message in browser using peer's derived key
      let plaintext = 'Could not decrypt message';
      let decryptionFailed = false;
      try {
        plaintext = await auth.sessionManager.decryptFromPeer(peerId, ciphertext, iv);
        if (plaintext === 'Could not decrypt message') {
          decryptionFailed = true;
        }
      } catch {
        decryptionFailed = true;
      }

      const newMsg: DisplayMessage = {
        id,
        from,
        to,
        plaintext,
        ciphertext,
        iv,
        createdAt,
        deliveredAt,
        decryptionFailed
      };

      setMessagesMap((prev) => {
        const existing = prev[peerId] || [];
        if (existing.some((m) => m.id === id)) return prev;
        return {
          ...prev,
          [peerId]: [...existing, newMsg]
        };
      });

      // Update peer list
      setPeersMap((prev) => {
        const current = prev[peerId] || { peerId, isOnline: false };
        return {
          ...prev,
          [peerId]: {
            ...current,
            lastMessage: plaintext,
            lastTime: new Date(createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            }),
            unreadCount:
              peerId !== selectedPeerId ? (current.unreadCount || 0) + 1 : 0
          }
        };
      });

      // If we received a message from peer, acknowledge delivery
      if (from !== auth.userId) {
        socket.emit('message:delivered', { messageId: id });
      }
    });

    // Delivery confirmation
    socket.on('message:delivered', (data: any) => {
      const { messageId, to, deliveredAt } = data;
      setMessagesMap((prev) => {
        const peerMessages = prev[to];
        if (!peerMessages) return prev;
        return {
          ...prev,
          [to]: peerMessages.map((m) =>
            m.id === messageId ? { ...m, deliveredAt } : m
          )
        };
      });
    });

    // Typing status
    socket.on('typing', (data: any) => {
      const { from, isTyping } = data;
      setTypingMap((prev) => ({
        ...prev,
        [from]: Boolean(isTyping)
      }));
    });

    // Presence updates
    socket.on('presence:update', (data: any) => {
      const { userId, status } = data;
      setPeersMap((prev) => {
        const current = prev[userId];
        if (!current) return prev;
        return {
          ...prev,
          [userId]: {
            ...current,
            isOnline: status === 'online'
          }
        };
      });
    });

    return () => {
      closeSocket();
    };
  }, [auth, selectedPeerId]);

  // Load chat history when peer is selected
  const loadPeerChat = useCallback(
    async (peerId: string) => {
      if (!auth) return;
      setSelectedPeerId(peerId);
      setChatError(null);

      // Reset unread count for this peer
      setPeersMap((prev) => {
        const current = prev[peerId] || { peerId, isOnline: false };
        return {
          ...prev,
          [peerId]: { ...current, unreadCount: 0 }
        };
      });

      // Compute or load safety number
      if (!safetyNumbers[peerId]) {
        try {
          const num = await auth.sessionManager.getSafetyNumber(peerId);
          setSafetyNumbers((prev) => ({ ...prev, [peerId]: num }));
        } catch (err: any) {
          setChatError(err.message || 'Failed to establish E2EE session with peer');
        }
      }

      // Fetch message history from REST API
      setLoadingHistory(true);
      try {
        const history = await getChatHistory(auth.token, peerId, 1, 50, auth.chatUrl);

        // Decrypt messages sequentially or in parallel
        const decryptedList: DisplayMessage[] = await Promise.all(
          history.messages.map(async (msg) => {
            let plaintext = 'Could not decrypt message';
            let decryptionFailed = false;
            try {
              plaintext = await auth.sessionManager.decryptFromPeer(
                peerId,
                msg.ciphertext,
                msg.iv
              );
              if (plaintext === 'Could not decrypt message') {
                decryptionFailed = true;
              }
            } catch {
              decryptionFailed = true;
            }

            return {
              id: msg.id,
              from: msg.from,
              to: msg.to,
              plaintext,
              ciphertext: msg.ciphertext,
              iv: msg.iv,
              createdAt: msg.createdAt,
              deliveredAt: msg.deliveredAt,
              decryptionFailed
            };
          })
        );

        // Backend returns newest first; reverse for chronological display
        decryptedList.reverse();

        setMessagesMap((prev) => ({
          ...prev,
          [peerId]: decryptedList
        }));
      } catch (err: any) {
        setChatError(err.message || 'Failed to load chat history');
      } finally {
        setLoadingHistory(false);
      }
    },
    [auth, safetyNumbers]
  );

  const handleSendMessage = async (text: string) => {
    if (!auth || !selectedPeerId) return;

    try {
      // 1. Encrypt message in browser using AES-GCM 256-bit with fresh 12-byte IV
      const encrypted = await auth.sessionManager.encryptForPeer(selectedPeerId, text);

      const socket = getSocket();
      if (!socket || !socket.connected) {
        setChatError('Socket disconnected. Reconnecting...');
        return;
      }

      // 2. Dispatch via Socket.io
      socket.emit(
        'message:send',
        {
          to: selectedPeerId,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv
        },
        (ack: any) => {
          if (ack && ack.status === 'error') {
            setChatError(ack.error || 'Failed to send message');
            return;
          }

          // Append sent message to local view
          const localMessage: DisplayMessage = {
            id: ack?.messageId || `local_${Date.now()}`,
            from: auth.userId,
            to: selectedPeerId,
            plaintext: text,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            createdAt: new Date().toISOString(),
            deliveredAt: ack?.deliveredAt || null
          };

          setMessagesMap((prev) => ({
            ...prev,
            [selectedPeerId]: [...(prev[selectedPeerId] || []), localMessage]
          }));

          setPeersMap((prev) => {
            const current = prev[selectedPeerId] || {
              peerId: selectedPeerId,
              isOnline: false
            };
            return {
              ...prev,
              [selectedPeerId]: {
                ...current,
                lastMessage: text,
                lastTime: new Date().toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })
              }
            };
          });
        }
      );
    } catch (err: any) {
      setChatError(err.message || 'Encryption or send failure');
    }
  };

  const handleTypingStart = () => {
    if (!selectedPeerId) return;
    const socket = getSocket();
    socket?.emit('typing:start', { to: selectedPeerId });
  };

  const handleTypingStop = () => {
    if (!selectedPeerId) return;
    const socket = getSocket();
    socket?.emit('typing:stop', { to: selectedPeerId });
  };

  const handleLogout = () => {
    closeSocket();
    setAuth(null);
    setSelectedPeerId(null);
    setMessagesMap({});
    setPeersMap({});
  };

  if (!auth) {
    return <Login onLogin={setAuth} />;
  }

  const peersList = Object.values(peersMap);
  const currentMessages = selectedPeerId ? messagesMap[selectedPeerId] || [] : [];
  const currentSafetyNumber = selectedPeerId
    ? safetyNumbers[selectedPeerId] || null
    : null;
  const isPeerOnline = selectedPeerId
    ? Boolean(peersMap[selectedPeerId]?.isOnline)
    : false;
  const isPeerTyping = selectedPeerId
    ? Boolean(typingMap[selectedPeerId])
    : false;

  return (
    <div className="app-container">
      <UserList
        currentUserId={auth.userId}
        peers={peersList}
        selectedPeerId={selectedPeerId}
        onSelectPeer={loadPeerChat}
        onLogout={handleLogout}
      />

      {selectedPeerId ? (
        <ChatWindow
          currentUserId={auth.userId}
          peerId={selectedPeerId}
          isPeerOnline={isPeerOnline}
          isPeerTyping={isPeerTyping}
          safetyNumber={currentSafetyNumber}
          messages={currentMessages}
          loadingHistory={loadingHistory}
          error={chatError}
          onSendMessage={handleSendMessage}
          onTypingStart={handleTypingStart}
          onTypingStop={handleTypingStop}
        />
      ) : (
        <div className="no-chat-selected">
          <div className="empty-selection-content">
            <div className="huge-icon">🛡️</div>
            <h2>Welcome to SecureChat, {auth.userId}</h2>
            <p>
              Your end-to-end encryption keys are active in this browser. Select a
              conversation or enter a user ID on the left to start a private chat.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

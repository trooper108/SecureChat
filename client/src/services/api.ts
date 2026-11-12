import { CHAT_URL } from '../config';

export interface HistoryMessage {
  id: string;
  from: string;
  to: string;
  ciphertext: string;
  iv: string;
  createdAt: string;
  deliveredAt: string | null;
}

export interface HistoryResponse {
  messages: HistoryMessage[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export async function uploadPublicKey(
  token: string,
  publicKey: JsonWebKey,
  apiUrl = CHAT_URL
): Promise<void> {
  const res = await fetch(`${apiUrl}/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ publicKey })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to upload public key: ${res.statusText}`);
  }
}

export async function getPeerPublicKey(
  token: string,
  peerId: string,
  apiUrl = CHAT_URL
): Promise<JsonWebKey> {
  const res = await fetch(`${apiUrl}/users/${encodeURIComponent(peerId)}/key`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`User '${peerId}' has not uploaded a public key yet.`);
    }
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to fetch key: ${res.statusText}`);
  }

  const data = await res.json();
  return data.publicKey;
}

export async function getChatHistory(
  token: string,
  peerId: string,
  page = 1,
  limit = 50,
  apiUrl = CHAT_URL
): Promise<HistoryResponse> {
  const res = await fetch(`${apiUrl}/messages/${encodeURIComponent(peerId)}?page=${page}&limit=${limit}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to fetch history: ${res.statusText}`);
  }

  return await res.json();
}

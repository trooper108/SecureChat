/**
 * IndexedDB storage for non-extractable CryptoKey instances.
 * Structured Clone allows storing non-extractable CryptoKey objects in IndexedDB
 * without extracting raw private key bytes into JavaScript memory.
 */

import { generateIdentityKeyPair } from './e2ee';

const DB_NAME = 'securechat_e2ee_keystore';
const DB_VERSION = 1;
const STORE_NAME = 'identities';

export interface StoredIdentity {
  userId: string;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  createdAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not available in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getStoredIdentity(userId: string): Promise<StoredIdentity | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(userId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveIdentity(
  userId: string,
  privateKey: CryptoKey,
  publicKeyJwk: JsonWebKey
): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item: StoredIdentity = {
      userId,
      privateKey,
      publicKeyJwk,
      createdAt: Date.now()
    };
    const request = store.put(item);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearIdentity(userId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(userId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves existing identity from IndexedDB or generates a new one.
 */
export async function getOrCreateIdentity(
  userId: string
): Promise<{ privateKey: CryptoKey; publicKeyJwk: JsonWebKey; isNew: boolean }> {
  const existing = await getStoredIdentity(userId);
  if (existing) {
    return {
      privateKey: existing.privateKey,
      publicKeyJwk: existing.publicKeyJwk,
      isNew: false
    };
  }

  // Generate new identity
  const { privateKey, publicKeyJwk } = await generateIdentityKeyPair();
  await saveIdentity(userId, privateKey, publicKeyJwk);

  return {
    privateKey,
    publicKeyJwk,
    isNew: true
  };
}

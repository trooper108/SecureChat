/**
 * Browser End-to-End Encryption module using Web Crypto API exclusively.
 * - Key Exchange: ECDH (P-256)
 * - Key Derivation: HKDF (SHA-256, fixed info string)
 * - Message Encryption: AES-GCM 256-bit with fresh random 12-byte IV per message
 * - Safety Number: Deterministic SHA-256 fingerprint of peer public keys
 */

import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  stringToUint8Array,
  uint8ArrayToString
} from './encoding';

export const HKDF_INFO_STRING = 'SecureChat-v1-ECDH-HKDF-AES-GCM';

export interface IdentityKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
}

/**
 * Generate ECDH P-256 key pair.
 * The private key is non-extractable (extractable: false).
 */
export async function generateIdentityKeyPair(): Promise<IdentityKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false, // Private key MUST NOT be extractable
    ['deriveKey', 'deriveBits']
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyJwk
  };
}

/**
 * Import a peer's public key from JWK format for ECDH derivation.
 */
export async function importPeerPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    []
  );
}

/**
 * Derive AES-GCM 256-bit key from own private key and peer's public key using ECDH + HKDF.
 */
export async function deriveSharedAesKey(
  myPrivateKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<CryptoKey> {
  // 1. ECDH: derive 256 bits of raw shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: peerPublicKey
    },
    myPrivateKey,
    256
  );

  // 2. Import shared bits as HKDF key
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  // 3. HKDF (SHA-256) with fixed info string to derive 256-bit AES-GCM key
  const infoBytes = stringToUint8Array(HKDF_INFO_STRING);
  return await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: infoBytes
    },
    hkdfKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext using AES-GCM.
 * Generates a fresh random 12-byte IV for every encryption call.
 */
export async function encryptMessage(
  plaintext: string,
  aesKey: CryptoKey
): Promise<EncryptedPayload> {
  // 12-byte (96-bit) IV recommended for AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedData = stringToUint8Array(plaintext);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    aesKey,
    encodedData
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    iv: arrayBufferToBase64(iv)
  };
}

/**
 * Decrypt ciphertext using AES-GCM.
 * Returns decrypted plaintext, or "Could not decrypt message" on failure.
 */
export async function decryptMessage(
  ciphertextBase64: string,
  ivBase64: string,
  aesKey: CryptoKey
): Promise<string> {
  try {
    const ciphertext = base64ToArrayBuffer(ciphertextBase64);
    const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv
      },
      aesKey,
      ciphertext
    );

    return uint8ArrayToString(decryptedBuffer);
  } catch {
    return 'Could not decrypt message';
  }
}

/**
 * Compute a mutual safety number (fingerprint) for two public keys.
 * Sorts keys deterministically so both peers compute the exact same number.
 */
export async function computeSafetyNumber(
  keyA: JsonWebKey,
  keyB: JsonWebKey
): Promise<string> {
  const coordA = `${keyA.x || ''}:${keyA.y || ''}`;
  const coordB = `${keyB.x || ''}:${keyB.y || ''}`;

  // Deterministic order
  const [first, second] = coordA < coordB ? [coordA, coordB] : [coordB, coordA];
  const combined = stringToUint8Array(`${first}###${second}`);

  const digest = await crypto.subtle.digest('SHA-256', combined);
  const bytes = new Uint8Array(digest);

  // Convert digest bytes into 6 groups of 5-digit numbers (30 digits total)
  const numbers: string[] = [];
  for (let i = 0; i < 6; i++) {
    const val = (bytes[i * 4] << 24) | (bytes[i * 4 + 1] << 16) | (bytes[i * 4 + 2] << 8) | bytes[i * 4 + 3];
    const positiveVal = Math.abs(val) % 100000;
    numbers.push(positiveVal.toString().padStart(5, '0'));
  }

  return numbers.join(' ');
}

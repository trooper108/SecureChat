import {
  importPeerPublicKey,
  deriveSharedAesKey,
  encryptMessage,
  decryptMessage,
  computeSafetyNumber,
  EncryptedPayload
} from '../crypto/e2ee';
import { getPeerPublicKey } from './api';

export interface PeerSession {
  peerId: string;
  peerPublicKeyJwk: JsonWebKey;
  aesKey: CryptoKey;
  safetyNumber: string;
}

export class SessionManager {
  private myPrivateKey: CryptoKey;
  private myPublicKeyJwk: JsonWebKey;
  private token: string;
  private apiUrl: string;
  private sessions: Map<string, PeerSession> = new Map();

  constructor(myPrivateKey: CryptoKey, myPublicKeyJwk: JsonWebKey, token: string, apiUrl: string) {
    this.myPrivateKey = myPrivateKey;
    this.myPublicKeyJwk = myPublicKeyJwk;
    this.token = token;
    this.apiUrl = apiUrl;
  }

  async getSession(peerId: string): Promise<PeerSession> {
    const existing = this.sessions.get(peerId);
    if (existing) {
      return existing;
    }

    // Fetch peer's public key from directory
    const peerPublicKeyJwk = await getPeerPublicKey(this.token, peerId, this.apiUrl);
    const peerPublicKey = await importPeerPublicKey(peerPublicKeyJwk);

    // Derive shared AES-GCM 256-bit key via ECDH + HKDF
    const aesKey = await deriveSharedAesKey(this.myPrivateKey, peerPublicKey);

    // Compute mutual safety number
    const safetyNumber = await computeSafetyNumber(this.myPublicKeyJwk, peerPublicKeyJwk);

    const session: PeerSession = {
      peerId,
      peerPublicKeyJwk,
      aesKey,
      safetyNumber
    };

    this.sessions.set(peerId, session);
    return session;
  }

  async encryptForPeer(peerId: string, plaintext: string): Promise<EncryptedPayload> {
    const session = await this.getSession(peerId);
    return await encryptMessage(plaintext, session.aesKey);
  }

  async decryptFromPeer(peerId: string, ciphertext: string, iv: string): Promise<string> {
    try {
      const session = await this.getSession(peerId);
      return await decryptMessage(ciphertext, iv, session.aesKey);
    } catch {
      return 'Could not decrypt message';
    }
  }

  async getSafetyNumber(peerId: string): Promise<string> {
    const session = await this.getSession(peerId);
    return session.safetyNumber;
  }
}

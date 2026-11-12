import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import {
  generateIdentityKeyPair,
  importPeerPublicKey,
  deriveSharedAesKey,
  encryptMessage,
  decryptMessage,
  computeSafetyNumber
} from '../src/crypto/e2ee';
import {
  getStoredIdentity,
  getOrCreateIdentity
} from '../src/crypto/keyStore';

describe('Web Crypto E2EE Helpers', () => {
  it('should generate non-extractable ECDH P-256 key pair with valid public JWK', async () => {
    const keyPair = await generateIdentityKeyPair();

    expect(keyPair.privateKey).toBeDefined();
    expect(keyPair.privateKey.extractable).toBe(false);
    expect(keyPair.privateKey.algorithm.name).toBe('ECDH');

    expect(keyPair.publicKeyJwk).toBeDefined();
    expect(keyPair.publicKeyJwk.kty).toBe('EC');
    expect(keyPair.publicKeyJwk.crv).toBe('P-256');
    expect(keyPair.publicKeyJwk.x).toBeDefined();
    expect(keyPair.publicKeyJwk.y).toBeDefined();
    // Private parameter d MUST NOT be present in public key JWK
    expect(keyPair.publicKeyJwk.d).toBeUndefined();
  });

  describe('Encryption & Decryption Round Trip', () => {
    it('should successfully encrypt and decrypt a message between Alice and Bob', async () => {
      // Alice generates key pair
      const alice = await generateIdentityKeyPair();
      // Bob generates key pair
      const bob = await generateIdentityKeyPair();

      // Alice imports Bob's public key
      const bobPublicKey = await importPeerPublicKey(bob.publicKeyJwk);
      // Bob imports Alice's public key
      const alicePublicKey = await importPeerPublicKey(alice.publicKeyJwk);

      // Alice derives shared AES key
      const aliceAesKey = await deriveSharedAesKey(alice.privateKey, bobPublicKey);
      // Bob derives shared AES key
      const bobAesKey = await deriveSharedAesKey(bob.privateKey, alicePublicKey);

      const plaintext = 'Secret message from Alice to Bob: Hello SecureChat!';

      // Alice encrypts
      const encrypted = await encryptMessage(plaintext, aliceAesKey);
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();

      // Bob decrypts
      const decrypted = await decryptMessage(encrypted.ciphertext, encrypted.iv, bobAesKey);
      expect(decrypted).toBe(plaintext);

      // Reverse direction: Bob encrypts, Alice decrypts
      const reply = 'Secret reply from Bob to Alice';
      const encryptedReply = await encryptMessage(reply, bobAesKey);
      const decryptedReply = await decryptMessage(
        encryptedReply.ciphertext,
        encryptedReply.iv,
        aliceAesKey
      );
      expect(decryptedReply).toBe(reply);
    });

    it('should return "Could not decrypt message" when decrypted with wrong key', async () => {
      const alice = await generateIdentityKeyPair();
      const bob = await generateIdentityKeyPair();
      const eve = await generateIdentityKeyPair(); // Unrelated third party

      const bobPublicKey = await importPeerPublicKey(bob.publicKeyJwk);
      const aliceAesKey = await deriveSharedAesKey(alice.privateKey, bobPublicKey);

      // Eve derives key with Bob
      const eveAesKey = await deriveSharedAesKey(eve.privateKey, bobPublicKey);

      const encrypted = await encryptMessage('Sensitive corporate data', aliceAesKey);

      // Eve attempts to decrypt message intended for Bob and sent by Alice
      const result = await decryptMessage(encrypted.ciphertext, encrypted.iv, eveAesKey);
      expect(result).toBe('Could not decrypt message');
    });

    it('should return "Could not decrypt message" when ciphertext is corrupted or tampered', async () => {
      const alice = await generateIdentityKeyPair();
      const bob = await generateIdentityKeyPair();

      const bobPublicKey = await importPeerPublicKey(bob.publicKeyJwk);
      const alicePublicKey = await importPeerPublicKey(alice.publicKeyJwk);

      const aliceAesKey = await deriveSharedAesKey(alice.privateKey, bobPublicKey);
      const bobAesKey = await deriveSharedAesKey(bob.privateKey, alicePublicKey);

      const encrypted = await encryptMessage('Tamper check message', aliceAesKey);

      // Corrupt the ciphertext
      const tamperedCiphertext = encrypted.ciphertext.substring(0, encrypted.ciphertext.length - 4) + 'AAAA';

      const result = await decryptMessage(tamperedCiphertext, encrypted.iv, bobAesKey);
      expect(result).toBe('Could not decrypt message');
    });
  });

  describe('IV Uniqueness Guarantee', () => {
    it('should generate a unique 12-byte IV for every message without reuse', async () => {
      const alice = await generateIdentityKeyPair();
      const bob = await generateIdentityKeyPair();
      const bobPublicKey = await importPeerPublicKey(bob.publicKeyJwk);
      const aliceAesKey = await deriveSharedAesKey(alice.privateKey, bobPublicKey);

      const ivSet = new Set<string>();
      const ciphertextSet = new Set<string>();
      const message = 'Same plaintext repeatedly encrypted';

      const iterations = 50;
      for (let i = 0; i < iterations; i++) {
        // eslint-disable-next-line no-await-in-loop
        const { ciphertext, iv } = await encryptMessage(message, aliceAesKey);
        ivSet.add(iv);
        ciphertextSet.add(ciphertext);
      }

      // Every IV must be unique
      expect(ivSet.size).toBe(iterations);
      // Every ciphertext must be unique due to distinct IV
      expect(ciphertextSet.size).toBe(iterations);
    });
  });

  describe('Safety Number (Fingerprint)', () => {
    it('should produce identical safety numbers regardless of peer order', async () => {
      const alice = await generateIdentityKeyPair();
      const bob = await generateIdentityKeyPair();

      const safetyNumberFromAlice = await computeSafetyNumber(
        alice.publicKeyJwk,
        bob.publicKeyJwk
      );
      const safetyNumberFromBob = await computeSafetyNumber(
        bob.publicKeyJwk,
        alice.publicKeyJwk
      );

      expect(safetyNumberFromAlice).toBe(safetyNumberFromBob);
      // Formatted in 6 blocks of 5 digits
      expect(safetyNumberFromAlice).toMatch(/^\d{5} \d{5} \d{5} \d{5} \d{5} \d{5}$/);
    });

    it('should produce different safety numbers for different peers', async () => {
      const alice = await generateIdentityKeyPair();
      const bob = await generateIdentityKeyPair();
      const charlie = await generateIdentityKeyPair();

      const aliceBobSafety = await computeSafetyNumber(alice.publicKeyJwk, bob.publicKeyJwk);
      const aliceCharlieSafety = await computeSafetyNumber(
        alice.publicKeyJwk,
        charlie.publicKeyJwk
      );

      expect(aliceBobSafety).not.toBe(aliceCharlieSafety);
    });
  });

  describe('IndexedDB Non-Extractable Key Persistence', () => {
    it('should store and retrieve non-extractable private key from IndexedDB', async () => {
      const userId = 'user_indexeddb_test';
      const identity = await getOrCreateIdentity(userId);

      expect(identity.isNew).toBe(true);
      expect(identity.privateKey.extractable).toBe(false);

      // Retrieve again
      const stored = await getStoredIdentity(userId);
      expect(stored).toBeDefined();
      expect(stored?.userId).toBe(userId);
      expect(stored?.privateKey.extractable).toBe(false);

      // getOrCreateIdentity returns existing
      const existing = await getOrCreateIdentity(userId);
      expect(existing.isNew).toBe(false);
      expect(existing.publicKeyJwk.x).toBe(identity.publicKeyJwk.x);
    });
  });
});

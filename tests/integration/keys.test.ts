import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app';
import { setupTestEnvironment, cleanupTestEnvironment } from '../helpers/testDb';
import { getEnv } from '../../src/config/env';

describe('User Directory & Public Keys API', () => {
  let app: any;
  const env = getEnv();
  const aliceId = 'user_alice';
  const bobId = 'user_bob';

  const aliceToken = jwt.sign({ sub: aliceId }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256' });
  const bobToken = jwt.sign({ sub: bobId }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256' });

  const validEcPublicKey = {
    kty: 'EC',
    crv: 'P-256',
    x: 'f83OJ3D2xFMTbKEAhWODxEmIrVitTXeYKv_5Iv3BwKE',
    y: 'ZRkr9xhYgkKMhlsNvpxUrsSb6006GL01bNeMaNUbkE8',
    use: 'enc'
  };

  const validOkpPublicKey = {
    kty: 'OKP',
    crv: 'X25519',
    x: '4zcljwGtIr_bJ9gVf9k0dY0mFqjQ5H1X3mQpZ3sJq2g'
  };

  beforeAll(async () => {
    await setupTestEnvironment();
    app = createApp();
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
  });

  describe('POST /keys', () => {
    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .post('/keys')
        .send({ publicKey: validEcPublicKey });

      expect(res.status).toBe(401);
    });

    it("should store the logged-in user's public key (JWK format)", async () => {
      const res = await request(app)
        .post('/keys')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ publicKey: validEcPublicKey });

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(aliceId);
      expect(res.body.publicKey.kty).toBe('EC');
      expect(res.body.publicKey.x).toBe(validEcPublicKey.x);
    });

    it('should reject request containing private key parameters (e.g. d)', async () => {
      const maliciousKeyWithPrivateKey = {
        ...validEcPublicKey,
        d: 'jpsQnnGQmL-YxKZPnnZuwoEndq8lWwaIv26pG7MiLfA' // Private scalar
      };

      const res = await request(app)
        .post('/keys')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ publicKey: maliciousKeyWithPrivateKey });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Forbidden private key parameter');
    });

    it('should reject symmetric keys (kty: oct)', async () => {
      const symmetricKey = {
        kty: 'oct',
        k: 'c2VjcmV0LWtleS12YWx1ZQ'
      };

      const res = await request(app)
        .post('/keys')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ publicKey: symmetricKey });

      expect(res.status).toBe(400);
    });

    it('should update and overwrite public key on subsequent POST /keys', async () => {
      const res = await request(app)
        .post('/keys')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ publicKey: validOkpPublicKey });

      expect(res.status).toBe(200);
      expect(res.body.publicKey.kty).toBe('OKP');
      expect(res.body.publicKey.crv).toBe('X25519');
    });
  });

  describe('GET /users/:id/key', () => {
    beforeAll(async () => {
      // Store Bob's public key
      await request(app)
        .post('/keys')
        .set('Authorization', `Bearer ${bobToken}`)
        .send({ publicKey: validEcPublicKey });
    });

    it('should fetch public key for an existing user', async () => {
      const res = await request(app)
        .get(`/users/${bobId}/key`)
        .set('Authorization', `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(bobId);
      expect(res.body.publicKey.kty).toBe('EC');
      expect(res.body.publicKey.x).toBe(validEcPublicKey.x);
    });

    it('should return 404 for a user without a stored public key', async () => {
      const res = await request(app)
        .get('/users/non_existent_user/key')
        .set('Authorization', `Bearer ${aliceToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not Found');
    });
  });
});

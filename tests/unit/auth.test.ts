import jwt from 'jsonwebtoken';
import {
  verifyAccessToken,
  expressAuthMiddleware,
  socketAuthMiddleware
} from '../../src/middleware/auth';
import { getEnv } from '../../src/config/env';

describe('Auth Middleware', () => {
  const env = getEnv();
  const validSecret = env.JWT_ACCESS_SECRET;
  const testUserId = 'user_abc123';

  function createToken(payload: object, secret = validSecret, options: jwt.SignOptions = { algorithm: 'HS256' }) {
    return jwt.sign(payload, secret, options);
  }

  describe('verifyAccessToken', () => {
    it('should verify a valid HS256 token with sub', () => {
      const token = createToken({ sub: testUserId, role: 'user' });
      const user = verifyAccessToken(token);
      expect(user.userId).toBe(testUserId);
      expect(user.role).toBe('user');
    });

    it('should verify token with userId fallback', () => {
      const token = createToken({ userId: 'user_xyz987' });
      const user = verifyAccessToken(token);
      expect(user.userId).toBe('user_xyz987');
    });

    it('should throw when token is signed with a different secret', () => {
      const token = createToken({ sub: testUserId }, 'wrong-secret');
      expect(() => verifyAccessToken(token)).toThrow();
    });

    it('should throw when token is expired', () => {
      const token = jwt.sign({ sub: testUserId }, validSecret, {
        algorithm: 'HS256',
        expiresIn: '-10s'
      });
      expect(() => verifyAccessToken(token)).toThrow();
    });

    it('should throw if user identifier is missing', () => {
      const token = createToken({ customField: 'test' });
      expect(() => verifyAccessToken(token)).toThrow('missing valid user identifier');
    });
  });

  describe('expressAuthMiddleware', () => {
    let req: any;
    let res: any;
    let next: jest.Mock;

    beforeEach(() => {
      req = { headers: {} };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      next = jest.fn();
    });

    it('should reject requests without authorization header', () => {
      expressAuthMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject malformed authorization header', () => {
      req.headers.authorization = 'Basic dXNlcjpwYXNz';
      expressAuthMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject empty Bearer token', () => {
      req.headers.authorization = 'Bearer ';
      expressAuthMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should attach user and call next() on valid Bearer token', () => {
      const token = createToken({ sub: testUserId });
      req.headers.authorization = `Bearer ${token}`;

      expressAuthMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.userId).toBe(testUserId);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('socketAuthMiddleware', () => {
    it('should authenticate socket with valid token in auth.token', (done) => {
      const token = createToken({ sub: testUserId });
      const socket: any = {
        handshake: { auth: { token }, headers: {} },
        data: {}
      };

      socketAuthMiddleware(socket, (err) => {
        expect(err).toBeUndefined();
        expect(socket.data.userId).toBe(testUserId);
        done();
      });
    });

    it('should authenticate socket with Bearer token in headers.authorization', (done) => {
      const token = createToken({ sub: testUserId });
      const socket: any = {
        handshake: { auth: {}, headers: { authorization: `Bearer ${token}` } },
        data: {}
      };

      socketAuthMiddleware(socket, (err) => {
        expect(err).toBeUndefined();
        expect(socket.data.userId).toBe(testUserId);
        done();
      });
    });

    it('should reject socket with missing token', (done) => {
      const socket: any = {
        handshake: { auth: {}, headers: {} },
        data: {}
      };

      socketAuthMiddleware(socket, (err) => {
        expect(err).toBeDefined();
        expect(err?.message).toContain('Missing access token');
        done();
      });
    });

    it('should reject socket with invalid token', (done) => {
      const socket: any = {
        handshake: { auth: { token: 'invalid.jwt.token' }, headers: {} },
        data: {}
      };

      socketAuthMiddleware(socket, (err) => {
        expect(err).toBeDefined();
        expect(err?.message).toContain('Invalid or expired access token');
        done();
      });
    });
  });
});

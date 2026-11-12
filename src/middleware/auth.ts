import { Request, Response, NextFunction } from 'express';
import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env';

export interface AuthenticatedUser {
  userId: string;
  [key: string]: any;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function verifyAccessToken(token: string): AuthenticatedUser {
  const env = getEnv();
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256']
  }) as any;

  const userId = payload.sub || payload.userId || payload.id;
  if (!userId || typeof userId !== 'string') {
    throw new Error('Token payload missing valid user identifier (sub/userId/id)');
  }

  return {
    userId,
    ...payload
  };
}

export function expressAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header'
    });
    return;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Access token is empty'
    });
    return;
  }

  try {
    const user = verifyAccessToken(token);
    req.user = user;
    next();
  } catch (err: any) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired access token'
    });
  }
}

export function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): void {
  const authToken = socket.handshake.auth?.token;
  const headerToken = socket.handshake.headers?.authorization;

  let rawToken: string | undefined = authToken || headerToken;
  if (!rawToken) {
    return next(new Error('Authentication error: Missing access token'));
  }

  if (typeof rawToken === 'string' && rawToken.startsWith('Bearer ')) {
    rawToken = rawToken.substring(7).trim();
  }

  try {
    const user = verifyAccessToken(rawToken);
    socket.data.userId = user.userId;
    socket.data.user = user;
    next();
  } catch (err: any) {
    return next(new Error('Authentication error: Invalid or expired access token'));
  }
}

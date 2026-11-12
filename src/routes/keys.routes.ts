import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { expressAuthMiddleware } from '../middleware/auth';
import { UserKeyModel } from '../models/userKey.model';

export const keysRouter = Router();

const FORBIDDEN_PRIVATE_PARAMS = new Set([
  'd', 'p', 'q', 'dp', 'dq', 'qi', 'dmp1', 'dmq1', 'coeff', 'oth', 'k'
]);

const rsaKeySchema = z.object({
  kty: z.literal('RSA'),
  n: z.string().min(1, 'RSA modulus (n) is required'),
  e: z.string().min(1, 'RSA exponent (e) is required'),
  alg: z.string().optional(),
  use: z.string().optional(),
  kid: z.string().optional()
}).passthrough();

const ecKeySchema = z.object({
  kty: z.literal('EC'),
  crv: z.string().min(1, 'Curve (crv) is required'),
  x: z.string().min(1, 'x coordinate is required'),
  y: z.string().min(1, 'y coordinate is required'),
  alg: z.string().optional(),
  use: z.string().optional(),
  kid: z.string().optional()
}).passthrough();

const okpKeySchema = z.object({
  kty: z.literal('OKP'),
  crv: z.string().min(1, 'Curve (crv) is required'),
  x: z.string().min(1, 'x coordinate is required'),
  alg: z.string().optional(),
  use: z.string().optional(),
  kid: z.string().optional()
}).passthrough();

export const jwkSchema = z.discriminatedUnion('kty', [
  rsaKeySchema,
  ecKeySchema,
  okpKeySchema
]).superRefine((data, ctx) => {
  for (const key of Object.keys(data)) {
    if (FORBIDDEN_PRIVATE_PARAMS.has(key.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden private key parameter detected: '${key}'. Private keys must never be sent to the server.`
      });
    }
  }
});

const postKeyBodySchema = z.object({
  publicKey: jwkSchema.optional()
}).passthrough().superRefine((data, ctx) => {
  const target = (data as any).publicKey || data;
  if (!target || !target.kty) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Valid public key in JWK format with 'kty' (RSA, EC, or OKP) is required"
    });
  }
});

// POST /keys - Store the logged-in user's public key (JWK format)
keysRouter.post('/keys', expressAuthMiddleware, async (req: Request, res: Response) => {
  const parseResult = postKeyBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: parseResult.error.errors.map((e) => e.message).join('; ')
    });
    return;
  }

  const rawJwk = (req.body.publicKey || req.body) as Record<string, any>;
  const jwkResult = jwkSchema.safeParse(rawJwk);
  if (!jwkResult.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: jwkResult.error.errors.map((e) => e.message).join('; ')
    });
    return;
  }

  const userId = req.user!.userId;
  const sanitizedJwk = jwkResult.data;

  const updatedRecord = await UserKeyModel.findOneAndUpdate(
    { userId },
    { userId, publicKey: sanitizedJwk },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(200).json({
    message: 'Public key stored successfully',
    userId: updatedRecord.userId,
    publicKey: updatedRecord.publicKey,
    updatedAt: updatedRecord.updatedAt
  });
});

// GET /users/:id/key - Fetch someone's public key
keysRouter.get('/users/:id/key', expressAuthMiddleware, async (req: Request, res: Response) => {
  const targetUserId = req.params.id;
  const userKey = await UserKeyModel.findOne({ userId: targetUserId }).lean();

  if (!userKey) {
    res.status(404).json({
      error: 'Not Found',
      message: `Public key not found for user '${targetUserId}'`
    });
    return;
  }

  res.status(200).json({
    userId: userKey.userId,
    publicKey: userKey.publicKey
  });
});

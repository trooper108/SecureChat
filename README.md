# SecureChat Backend

A secure, real-time 1-to-1 chat backend built with Node.js 20, TypeScript, Express, Socket.io, MongoDB, and Redis.

## Core Features & Architecture

1. **Authentication**
   - Stateless JWT verification with shared secret (`JWT_ACCESS_SECRET`, HS256).
   - Express middleware (`expressAuthMiddleware`) and Socket.io handshake middleware (`socketAuthMiddleware`) rejecting unauthorized requests.
2. **User Directory & E2EE Public Key Exchange**
   - `POST /keys`: Logged-in users register their public key in standard JWK format (`RSA`, `EC`, `OKP`).
   - Server strictly forbids private key parameters (`d`, `p`, `q`, etc.) or symmetric keys (`oct`), guaranteeing the server never sees private keys.
   - `GET /users/:id/key`: Fetches a peer's public key.
3. **End-to-End Encrypted Message Storage**
   - MongoDB Schema: `{ from, to, ciphertext, iv, createdAt, deliveredAt }`.
   - The server treats payload and IV as opaque ciphertext and never decrypts messages.
4. **Real-Time Messaging & Offline Delivery**
   - Socket.io event `message:send` delivers in real-time to online recipients (`message:new`) and confirms delivery back to sender (`message:delivered`).
   - If the recipient is offline, messages are stored in MongoDB with `deliveredAt = null` and automatically dispatched upon reconnect.
   - `GET /messages/:peerId`: Paginated chat history with limit, page, and cursor-based (`before`) filtering.
5. **Presence & Rate Limiting**
   - Online/offline presence tracked in Redis (`presenceService`).
   - Redis-backed sliding/window rate limiting per user on `message:send`.
   - Graceful fail-open: Redis connection errors are logged and never crash the process. Automatic TLS is used when `REDIS_URL` starts with `rediss://`.
6. **Health Check**
   - `GET /health`: Probes connection state for both MongoDB and Redis (returns 200 OK or 503 Degraded).

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `NODE_ENV` | Environment (`development`, `production`, `test`) | `development` |
| `JWT_ACCESS_SECRET` | Shared secret for HS256 JWT verification | *Required* |
| `MONGODB_URI` | MongoDB connection string | *Required* |
| `REDIS_URL` | Redis connection URL (`redis://` or `rediss://`) | *Required* |
| `CORS_ORIGIN` | Allowed CORS origins or `*` | `*` |
| `MESSAGE_RATE_LIMIT_WINDOW_SECS` | Window duration for rate limiting | `60` |
| `MESSAGE_RATE_LIMIT_MAX` | Max messages allowed per window | `30` |

Copy `.env.example` to `.env` for local development:
```bash
cp .env.example .env
```

---

## Development & Testing

```bash
# Install dependencies
npm install

# Run all tests (passes without any local .env file)
npm test

# Build TypeScript to dist/
npm run build

# Start production server
npm start

# Run in development mode
npm run dev
```

---

## Docker Deployment

To launch the backend along with MongoDB and Redis:

```bash
docker compose up --build
```

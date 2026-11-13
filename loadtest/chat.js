import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom performance metrics
export const connectionSuccessRate = new Rate('connection_success_rate');
export const messageLatency = new Trend('message_latency', true); // Tracks p90, p95, p99
export const messagesSent = new Counter('messages_sent');
export const messagesReceived = new Counter('messages_received');

export const options = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS, 10) : 20,
  duration: __ENV.DURATION || '30s',
  thresholds: {
    connection_success_rate: ['rate>0.95'],
    message_latency: ['p(95)<500'] // p95 latency under 500ms
  }
};

const BASE_URL = __ENV.TARGET_URL || 'ws://localhost:3000';
// Default token signed with shared secret for testing, or passed via TOKEN env var
const TOKEN = __ENV.TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyX2xvYWR0ZXN0XzEiLCJpYXQiOjE1MTYyMzkwMjJ9.eS8lH_Q1_Sj5Q7jW0UfR_Wd-v6wH3_eH3Y_xZ0Q_k0g';

export default function () {
  const vuId = __VU;
  const iteration = __ITER;
  const currentUserId = `loadtest_user_${vuId}`;
  const targetPeerId = `loadtest_user_${vuId === 1 ? 2 : 1}`;

  // Connect to Socket.io via WebSocket transport
  const url = `${BASE_URL}/socket.io/?EIO=4&transport=websocket`;

  let connected = false;
  let sentAt = 0;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      // 1. Send Engine.io / Socket.io handshake with auth token
      const handshakePayload = JSON.stringify({ token: TOKEN, userId: currentUserId });
      socket.send(`40${handshakePayload}`);
    });

    socket.on('message', (data) => {
      // Engine.io ping -> respond with pong
      if (data === '2') {
        socket.send('3');
        return;
      }

      // Socket.io connection acknowledged
      if (data.startsWith('40')) {
        connected = true;
        connectionSuccessRate.add(1);

        // Send a chat message after handshake
        sentAt = Date.now();
        const payload = JSON.stringify([
          'message:send',
          {
            to: targetPeerId,
            ciphertext: `encrypted_payload_sample_vu_${vuId}_iter_${iteration}`,
            iv: `random_iv_12_bytes_${vuId}_${iteration}`
          }
        ]);
        socket.send(`42${payload}`);
        messagesSent.add(1);
        return;
      }

      // Received message response or delivery confirmation
      if (data.startsWith('42')) {
        const receivedAt = Date.now();
        if (sentAt > 0) {
          const latency = receivedAt - sentAt;
          messageLatency.add(latency);
          sentAt = 0; // reset
        }
        messagesReceived.add(1);

        // Sleep briefly before closing or sending next message
        sleep(0.5);
        socket.close();
      }
    });

    socket.on('close', () => {
      // Disconnected
    });

    socket.on('error', (err) => {
      if (!connected) {
        connectionSuccessRate.add(0);
      }
    });

    // Timeout safety
    socket.setTimeout(() => {
      if (!connected) {
        connectionSuccessRate.add(0);
      }
      socket.close();
    }, 5000);
  });

  check(res, { 'WebSocket connection successful': (r) => r && r.status === 101 });
}

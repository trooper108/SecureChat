import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;

export function getSocket(): Socket | null {
  return socketInstance;
}

export function initSocket(chatUrl: string, token: string): Socket {
  if (socketInstance) {
    socketInstance.disconnect();
  }

  socketInstance = io(chatUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true
  });

  return socketInstance;
}

export function closeSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

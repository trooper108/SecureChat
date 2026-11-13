import http, { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { Application } from 'express';
import { createApp } from './app';
import { setupSocketServer, SocketServerOptions } from './socket/chat.socket';

export interface ServerInstance {
  app: Application;
  httpServer: HttpServer;
  io: SocketServer;
}

export function createServer(options?: SocketServerOptions): ServerInstance {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = setupSocketServer(httpServer, options);

  return { app, httpServer, io };
}

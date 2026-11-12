import pino from 'pino';

const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

export const logger = pino({
  level: logLevel,
  timestamp: pino.stdTimeFunctions.isoTime
});

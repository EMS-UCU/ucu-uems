import * as Sentry from '@sentry/react';

type LogLevel = 'info' | 'warn' | 'error';

const isProd = import.meta.env.PROD;
const isSentryEnabled = Boolean(import.meta.env.VITE_SENTRY_DSN);

function sanitizeContext(context: unknown): unknown {
  if (!context || typeof context !== 'object') return context;

  const clone: any = JSON.parse(JSON.stringify(context));

  const redactKeys = [
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'supabaseKey',
    'apiKey',
    'keyPrefix',
    'anonKey',
  ];

  for (const key of redactKeys) {
    if (key in clone) {
      clone[key] = '[redacted]';
    }
  }

  return clone;
}

function sendToSentry(level: LogLevel, message: string, context?: unknown) {
  if (!isSentryEnabled) return;

  const extra = context ? sanitizeContext(context) : undefined;

  if (level === 'error') {
    Sentry.captureMessage(message, {
      level: 'error',
      extra,
    });
  } else {
    Sentry.captureMessage(message, {
      level,
      extra,
    });
  }
}

export const logger = {
  info(message: string, context?: unknown) {
    // Do not write anything to the browser console; send only to Sentry
    sendToSentry('info', message, context);
  },

  warn(message: string, context?: unknown) {
    sendToSentry('warn', message, context);
  },

  error(message: string, context?: unknown) {
    sendToSentry('error', message, context);
  },
};


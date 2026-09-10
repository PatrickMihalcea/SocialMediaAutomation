import type { Platform } from '@prisma/client';

/**
 * Every failure a network can hand back, reduced to three questions the
 * publishing engine actually needs answered: should we retry, does the user need
 * to reconnect, and what do we tell them.
 */
export class PlatformError extends Error {
  readonly platform: Platform;
  readonly code: string;
  readonly retryable: boolean;
  readonly needsReconnect: boolean;
  readonly status?: number;
  /** Raw provider response — logged server-side, never shown to the user. */
  readonly detail?: string;
  /** Set by rate-limit responses that carry Retry-After. */
  readonly retryAfterSeconds?: number;

  constructor(init: {
    platform: Platform;
    code: string;
    message: string;
    retryable?: boolean;
    needsReconnect?: boolean;
    status?: number;
    detail?: string;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.name = 'PlatformError';
    this.platform = init.platform;
    this.code = init.code;
    this.retryable = init.retryable ?? false;
    this.needsReconnect = init.needsReconnect ?? false;
    this.status = init.status;
    this.detail = init.detail;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

const LABEL: Record<Platform, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  LINKEDIN: 'LinkedIn',
  X: 'X',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  MOCK: 'Demo channel',
};

export const platformLabel = (p: Platform) => LABEL[p];

/**
 * Turns an HTTP status into a user-facing sentence and a retry decision. The
 * wording follows the product rule in the brief: say what to do, not what the
 * status code was.
 */
export function classifyHttp(
  platform: Platform,
  status: number,
  body: string,
  retryAfterSeconds?: number,
): PlatformError {
  const name = LABEL[platform];

  if (status === 401 || status === 403) {
    return new PlatformError({
      platform,
      code: 'AUTH',
      status,
      detail: body,
      needsReconnect: true,
      message: `${name} authorization expired. Reconnect ${name} to continue publishing.`,
    });
  }
  if (status === 429) {
    return new PlatformError({
      platform,
      code: 'RATE_LIMIT',
      status,
      detail: body,
      retryable: true,
      retryAfterSeconds: retryAfterSeconds ?? 900,
      message: `${name} is rate limiting this account. Bridge88 will try again shortly.`,
    });
  }
  if (status === 404) {
    return new PlatformError({
      platform,
      code: 'NOT_FOUND',
      status,
      detail: body,
      message: `${name} could not find the account or post this was aimed at.`,
    });
  }
  if (status >= 500) {
    return new PlatformError({
      platform,
      code: 'UPSTREAM',
      status,
      detail: body,
      retryable: true,
      message: `${name} is unavailable right now. Bridge88 will try again.`,
    });
  }
  return new PlatformError({
    platform,
    code: 'REJECTED',
    status,
    detail: body,
    message: `${name} rejected this post. Check the content against the channel's rules and try again.`,
  });
}

export function networkError(platform: Platform, cause: unknown): PlatformError {
  const isTimeout = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
  return new PlatformError({
    platform,
    code: isTimeout ? 'TIMEOUT' : 'NETWORK',
    retryable: true,
    cause,
    detail: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
    message: isTimeout
      ? `${LABEL[platform]} did not respond in time. Bridge88 will try again.`
      : `Bridge88 could not reach ${LABEL[platform]}. It will try again.`,
  });
}

export function notConfigured(platform: Platform): PlatformError {
  return new PlatformError({
    platform,
    code: 'NOT_CONFIGURED',
    message: `${LABEL[platform]} is not set up on this deployment. Add its API credentials, or use a demo channel.`,
  });
}

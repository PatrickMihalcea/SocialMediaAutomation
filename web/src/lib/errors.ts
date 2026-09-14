/**
 * Application errors carry two messages: `message` is written for the person
 * reading the screen and is safe to send to the browser; `detail` is for the
 * server log and may contain provider responses, ids and stack context.
 */
export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'LIMIT_REACHED'
  | 'PROVIDER_ERROR'
  | 'TOKEN_EXPIRED'
  | 'INTERNAL';

const STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  LIMIT_REACHED: 402,
  PROVIDER_ERROR: 502,
  TOKEN_EXPIRED: 401,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly detail?: string;
  readonly fields?: Record<string, string[]>;

  constructor(
    code: AppErrorCode,
    message: string,
    options: { detail?: string; fields?: Record<string, string[]>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.detail = options.detail;
    this.fields = options.fields;
  }
}

export const unauthenticated = (m = 'Sign in to continue.') => new AppError('UNAUTHENTICATED', m);
export const forbidden = (m = 'You do not have access to this workspace.') => new AppError('FORBIDDEN', m);
export const notFound = (m = 'That item no longer exists.') => new AppError('NOT_FOUND', m);
export const invalid = (m: string, fields?: Record<string, string[]>) =>
  new AppError('VALIDATION', m, { fields });
export const conflict = (m: string) => new AppError('CONFLICT', m);
export const limitReached = (m: string) => new AppError('LIMIT_REACHED', m);

/**
 * Next signals redirect() and notFound() by throwing. Those are control flow,
 * not failures, and must reach the framework untouched — swallowing one turns a
 * redirect into a 500. Matched on the digest so this file stays import-free.
 */
function isFrameworkControlFlow(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  if (typeof digest !== 'string') return false;
  return (
    digest.startsWith('NEXT_REDIRECT') ||
    digest.startsWith('NEXT_HTTP_ERROR_FALLBACK') ||
    digest === 'NEXT_NOT_FOUND'
  );
}

/** Narrows anything thrown into a shape the API layer can serialise. */
export function toAppError(e: unknown): AppError {
  if (isFrameworkControlFlow(e)) throw e;
  if (e instanceof AppError) return e;
  const detail = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e);
  return new AppError('INTERNAL', 'Something went wrong on our side. Try again.', { detail, cause: e });
}

import type { Platform } from '@prisma/client';
import { classifyHttp, networkError, PlatformError } from '@/lib/social/errors';

const DEFAULT_TIMEOUT_MS = 20_000;

export interface PlatformRequest {
  platform: Platform;
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: BodyInit | null;
  timeoutMs?: number;
}

/**
 * The only way adapters reach the network. Guarantees a timeout on every call
 * (rule 6 in the brief) and normalises failures into PlatformError so callers
 * never branch on raw status codes.
 */
export async function platformFetch(req: PlatformRequest): Promise<Response> {
  const timeout = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetch(req.url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(timeout),
      cache: 'no-store',
    });
  } catch (cause) {
    throw networkError(req.platform, cause);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const retryAfter = Number(response.headers.get('retry-after'));
    throw classifyHttp(req.platform, response.status, body, Number.isFinite(retryAfter) ? retryAfter : undefined);
  }
  return response;
}

export async function platformJson<T>(req: PlatformRequest): Promise<T> {
  const response = await platformFetch(req);
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new PlatformError({
      platform: req.platform,
      code: 'BAD_RESPONSE',
      message: 'The network returned a response Bridge88 could not read.',
      detail: text.slice(0, 2000),
      retryable: true,
      cause,
    });
  }
}

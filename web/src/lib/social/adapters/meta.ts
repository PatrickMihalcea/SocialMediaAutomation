import type { Platform } from '@prisma/client';
import { BaseAdapter } from '@/lib/social/base';
import { env } from '@/lib/env';
import { platformJson } from '@/lib/social/http';
import { notConfigured, PlatformError } from '@/lib/social/errors';
import type { AuthorizationRequest, DecryptedAccount, RefreshedToken } from '@/lib/social/types';

export const GRAPH_VERSION = 'v21.0';
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Instagram and Facebook are one Meta app behind the same Graph API and the same
 * OAuth dialog, so the connection half lives here and each network's publishing
 * rules live in its own adapter.
 *
 * INTEGRATION BOUNDARY — production use needs a Meta app with the scopes below
 * and Meta App Review. Without META_APP_ID/META_APP_SECRET this adapter reports
 * itself unconfigured and the Connect dialog offers a demo channel instead.
 */
export abstract class MetaAdapter extends BaseAdapter {
  protected abstract readonly scopes: string[];

  isConfigured(): boolean {
    return Boolean(env.META_APP_ID && env.META_APP_SECRET);
  }

  async getAuthorizationUrl(input: { redirectUri: string; state: string }): Promise<AuthorizationRequest> {
    if (!this.isConfigured()) throw notConfigured(this.platform);
    const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    url.searchParams.set('client_id', env.META_APP_ID);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.scopes.join(','));
    return { url: url.toString() };
  }

  /** Short-lived user token → long-lived user token (~60 days). */
  protected async exchangeForLongLivedToken(code: string, redirectUri: string): Promise<string> {
    if (!this.isConfigured()) throw notConfigured(this.platform);

    const short = await platformJson<{ access_token: string }>({
      platform: this.platform,
      url:
        `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(env.META_APP_ID)}` +
        `&client_secret=${encodeURIComponent(env.META_APP_SECRET)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`,
    });

    const long = await platformJson<{ access_token: string }>({
      platform: this.platform,
      url:
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
        `&client_id=${encodeURIComponent(env.META_APP_ID)}` +
        `&client_secret=${encodeURIComponent(env.META_APP_SECRET)}` +
        `&fb_exchange_token=${encodeURIComponent(short.access_token)}`,
    });
    return long.access_token;
  }

  /** Pages the signed-in user administers, each with its own page token. */
  protected async listPages(userToken: string): Promise<MetaPage[]> {
    const res = await platformJson<{ data: MetaPage[] }>({
      platform: this.platform,
      url: `${GRAPH}/me/accounts?fields=id,name,username,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(userToken)}`,
    });
    return res.data ?? [];
  }

  /**
   * Page tokens derived from a long-lived user token do not expire on their own,
   * so there is nothing to refresh; the account is re-validated instead and the
   * user is prompted to reconnect if Meta has invalidated it.
   */
  async refreshToken(_account: DecryptedAccount): Promise<RefreshedToken | null> {
    return null;
  }

  async disconnect(account: DecryptedAccount): Promise<void> {
    const token = this.requireToken(account);
    await platformJson({
      platform: this.platform,
      method: 'DELETE',
      url: `${GRAPH}/me/permissions?access_token=${encodeURIComponent(token)}`,
    });
  }

  protected graphError(detail: string): PlatformError {
    return new PlatformError({
      platform: this.platform,
      code: 'REJECTED',
      message: `${this.label} rejected this post. Check the caption and media against the channel's rules.`,
      detail,
    });
  }

  /**
   * Container-based publishing (Instagram video, Facebook video) is asynchronous:
   * the network takes the media, transcodes it, and only then accepts the publish
   * call. Polls with a ceiling rather than forever.
   */
  protected async pollUntilReady(
    check: () => Promise<{ ready: boolean; failed?: boolean; message?: string }>,
    { attempts = 30, intervalMs = 4000 } = {},
  ): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      const state = await check();
      if (state.ready) return;
      if (state.failed) {
        throw new PlatformError({
          platform: this.platform,
          code: 'MEDIA_REJECTED',
          message: state.message ?? `${this.label} could not process this media file.`,
        });
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new PlatformError({
      platform: this.platform,
      code: 'TIMEOUT',
      retryable: true,
      message: `${this.label} is still processing the media. Bridge88 will try again.`,
    });
  }
}

export interface MetaPage {
  id: string;
  name: string;
  username?: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  };
}

export const asPlatform = <T extends Platform>(p: T) => p;

// Cloudflare Worker that mints short-lived TURN credentials and returns them
// as a JSON array of RTCIceServer entries, which is exactly what
// src/net/rtcConfig.ts (`fetchIceServers`) consumes.
//
// Secrets (set via `wrangler secret put`):
//   TURN_TOKEN_ID   - Cloudflare Realtime TURN app token id
//   TURN_API_TOKEN  - Cloudflare Realtime TURN app API token
//
// Vars (in wrangler.toml):
//   ALLOWED_ORIGINS    - comma-separated list of browser origins permitted by CORS
//   TURN_TTL_SECONDS   - credential lifetime in seconds

interface Env {
  TURN_TOKEN_ID: string;
  TURN_API_TOKEN: string;
  ALLOWED_ORIGINS: string;
  TURN_TTL_SECONDS: string;
  RATE_LIMITER: { limit(input: { key: string }): Promise<{ success: boolean }> };
}

type IceServer = { urls: string[] | string; username?: string; credential?: string };

function parseIceServers(value: unknown): IceServer[] | undefined {
  if (!value || typeof value !== 'object' || !('iceServers' in value)) return undefined;
  const servers: unknown[] = Array.isArray(value.iceServers) ? value.iceServers : [value.iceServers];
  if (!servers.length || !servers.every((server) => {
    if (!server || typeof server !== 'object' || !('urls' in server)) return false;
    const urls: unknown[] = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.length > 0 && urls.every((url) => typeof url === 'string' && /^(stun|stuns|turn|turns):\S+$/.test(url)) &&
      (!('username' in server) || typeof server.username === 'string') &&
      (!('credential' in server) || typeof server.credential === 'string');
  })) return undefined;
  return servers as IceServer[];
}

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const match = origin && allowed.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': match,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowed = (typeof env.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS : '').split(',').map((o) => o.trim()).filter(Boolean);
    const cors = corsHeaders(origin, allowed);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return new Response('method not allowed', { status: 405, headers: cors });
    }
    if (!cors['Access-Control-Allow-Origin']) {
      return new Response('origin not allowed', { status: 403 });
    }

    const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const fail = (status: number, message: string) => new Response(message, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
    const ttl = Number(env.TURN_TTL_SECONDS?.trim() || '86400');
    if (!env.TURN_TOKEN_ID?.trim() || !env.TURN_API_TOKEN?.trim() || !Number.isSafeInteger(ttl) || ttl < 60 || ttl > 86_400) {
      return fail(503, 'service unavailable');
    }
    let success: boolean;
    try {
      ({ success } = await env.RATE_LIMITER.limit({ key: clientIp }));
    } catch {
      return fail(503, 'service unavailable');
    }
    if (!success) {
      return new Response('rate limit exceeded', {
        status: 429,
        headers: { ...cors, 'Retry-After': '60' },
      });
    }

    let upstream: Response;
    try {
      upstream = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_TOKEN_ID)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TURN_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl }),
        signal: AbortSignal.timeout(10_000),
      },
      );
    } catch {
      return fail(502, 'TURN provider unavailable');
    }

    if (!upstream.ok) {
      return fail(502, 'TURN provider unavailable');
    }

    let data: unknown;
    try { data = await upstream.json(); } catch { return fail(502, 'TURN provider returned an invalid response'); }
    const ice = parseIceServers(data);
    if (!ice) return fail(502, 'TURN provider returned an invalid response');
    return new Response(JSON.stringify(ice), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  },
};

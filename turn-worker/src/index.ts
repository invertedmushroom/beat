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

interface CloudflareTurnResponse {
  iceServers: { urls: string[] | string; username?: string; credential?: string };
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
    const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
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
    const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
    if (!success) {
      return new Response('rate limit exceeded', {
        status: 429,
        headers: { ...cors, 'Retry-After': '60' },
      });
    }

    const ttl = Number.parseInt(env.TURN_TTL_SECONDS || '86400', 10);
    const upstream = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_TOKEN_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TURN_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl }),
      },
    );

    if (!upstream.ok) {
      const detail = await upstream.text();
      return new Response(`turn upstream failed: ${upstream.status} ${detail}`, {
        status: 502,
        headers: cors,
      });
    }

    const data = (await upstream.json()) as CloudflareTurnResponse;
    const ice = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
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

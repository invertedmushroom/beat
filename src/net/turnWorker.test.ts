import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../turn-worker/src/index';

const env = {
  TURN_TOKEN_ID: 'test-id', TURN_API_TOKEN: 'test-token', ALLOWED_ORIGINS: 'https://beat.test', TURN_TTL_SECONDS: '86400',
  RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const request = () => new Request('https://turn.test/', { headers: { Origin: 'https://beat.test' } });
afterEach(() => vi.unstubAllGlobals());

describe('TURN worker failure boundaries', () => {
  it.each(['abc', '30oops', '0', '-1', '86401'])('rejects invalid credential TTL %s before fetching', async (ttl) => {
    const fetch = vi.fn(async () => Response.json({ iceServers: { urls: 'turn:relay.test' } }));
    vi.stubGlobal('fetch', fetch);
    expect((await worker.fetch(request(), { ...env, TURN_TTL_SECONDS: ttl })).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('contains network and JSON failures and sanitizes provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private provider detail')));
    expect((await worker.fetch(request(), env)).status).toBe(502);
    vi.stubGlobal('fetch', async () => new Response('private provider detail', { status: 500 }));
    const failed = await worker.fetch(request(), env);
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain('private provider detail');
    vi.stubGlobal('fetch', async () => new Response('not-json'));
    expect((await worker.fetch(request(), env)).status).toBe(502);
  });

  it('rejects malformed ICE payloads and accepts the provider object or array shape', async () => {
    for (const payload of [{}, { iceServers: [null] }, { iceServers: { urls: [] } }]) {
      vi.stubGlobal('fetch', async () => Response.json(payload));
      expect((await worker.fetch(request(), env)).status).toBe(502);
    }
    const ice = { urls: ['turn:relay.test:3478'], username: 'user', credential: 'credential' };
    for (const iceServers of [ice, [ice]]) {
      vi.stubGlobal('fetch', async () => Response.json({ iceServers }));
      expect(await (await worker.fetch(request(), env)).json()).toEqual([ice]);
    }
  });

  it('retains CORS and rate limiting behavior', async () => {
    expect((await worker.fetch(new Request('https://turn.test'), env)).status).toBe(403);
    expect((await worker.fetch(request(), { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } })).status).toBe(429);
    expect((await worker.fetch(request(), { ...env, RATE_LIMITER: { limit: async () => { throw new Error('binding unavailable'); } } })).status).toBe(503);
  });
});

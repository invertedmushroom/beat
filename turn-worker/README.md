# beat-turn-worker

Cloudflare Worker that mints short-lived TURN credentials for the Beat
client. The browser fetches `GET /` and receives a JSON array of
`RTCIceServer` entries that [`src/net/rtcConfig.ts`](../src/net/rtcConfig.ts)
consumes directly via `VITE_ICE_SERVERS_URL`.

## Setup

```sh
cd turn-worker
npm install
npx wrangler login
npx wrangler secret put TURN_TOKEN_ID    # paste your Cloudflare TURN token id
npx wrangler secret put TURN_API_TOKEN   # paste your Cloudflare TURN API token
```

Edit `wrangler.toml` and set `ALLOWED_ORIGINS` to your GitHub Pages origin
(plus `http://localhost:5173` for local dev).

## Local dev

```sh
cp .dev.vars.example .dev.vars   # fill in values for local only
npm run dev
```

Then point the Beat client at the local worker:

```
VITE_ICE_SERVERS_URL=http://127.0.0.1:8787
```

## Deploy

```sh
npm run deploy
```

Use the resulting `https://beat-turn.<your-subdomain>.workers.dev` URL as
`VITE_ICE_SERVERS_URL` in your GitHub Pages build environment.

## Security notes

- Secrets live in Cloudflare, never in the frontend bundle.
- CORS is locked to `ALLOWED_ORIGINS`; update before deploying.
- Credentials are short-lived (`TURN_TTL_SECONDS`, default 24h).
- Rotate `TURN_API_TOKEN` if it ever leaks.

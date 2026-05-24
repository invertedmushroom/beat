// Boundary module: reads Vite env once and exposes the RTCConfiguration used
// by every RTCPeerConnection in the app. Keep env access here so the rest of
// src/net stays portable.

const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302'];

let cachedRtcConfig: Promise<RTCConfiguration> | undefined;

function readEnv(key: string): string | undefined {
  const value = import.meta.env[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readEnvList(...keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = readEnv(key);
    if (!value) {
      continue;
    }
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (items.length > 0) {
      return items;
    }
  }
  return undefined;
}

function normalizeUrls(urls: string | string[] | undefined): string[] {
  if (!urls) {
    return [];
  }
  return Array.isArray(urls) ? urls : [urls];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toIceServer(value: unknown): RTCIceServer | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const urls = value.urls;
  if (typeof urls !== 'string' && !(Array.isArray(urls) && urls.every((entry) => typeof entry === 'string'))) {
    return undefined;
  }
  const server: RTCIceServer = { urls };
  if (typeof value.username === 'string') {
    server.username = value.username;
  }
  if (typeof value.credential === 'string') {
    server.credential = value.credential;
  }
  return server;
}

function buildEnvIceServers(): RTCIceServer[] {
  const stunUrls = readEnvList('VITE_STUN_URLS', 'VITE_STUN_URL') ?? DEFAULT_STUN_URLS;
  const servers: RTCIceServer[] = [{ urls: stunUrls }];

  const turnUrls = readEnvList('VITE_TURN_URLS', 'VITE_TURN_URL');
  if (!turnUrls) {
    return servers;
  }

  servers.push({
    urls: turnUrls,
    username: readEnv('VITE_TURN_USERNAME'),
    credential: readEnv('VITE_TURN_CREDENTIAL'),
  });
  return servers;
}

async function fetchIceServers(): Promise<RTCIceServer[] | undefined> {
  const url = readEnv('VITE_ICE_SERVERS_URL');
  if (!url) {
    return undefined;
  }

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`ICE server fetch failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error('ICE server fetch failed: expected a JSON array');
  }

  const servers = payload.map((entry) => toIceServer(entry)).filter((entry): entry is RTCIceServer => Boolean(entry));
  if (servers.length === 0) {
    throw new Error('ICE server fetch failed: response did not contain valid ICE servers');
  }
  return servers;
}

async function loadRtcConfig(): Promise<RTCConfiguration> {
  try {
    const remoteIceServers = await fetchIceServers();
    if (remoteIceServers) {
      return { iceServers: remoteIceServers };
    }
  } catch (error: unknown) {
    console.warn(readError(error));
  }

  return {
    iceServers: buildEnvIceServers(),
  };
}

export async function getRtcConfig(): Promise<RTCConfiguration> {
  cachedRtcConfig ??= loadRtcConfig();
  return cachedRtcConfig;
}

export function describeRtcConfig(config: RTCConfiguration): string {
  const servers = config.iceServers ?? [];
  const hasTurn = servers.some((server) => normalizeUrls(server.urls).some((url) => url.startsWith('turn:') || url.startsWith('turns:')));
  const usesRemoteIce = Boolean(readEnv('VITE_ICE_SERVERS_URL'));
  if (usesRemoteIce) {
    return hasTurn ? 'ice config ready: fetched ICE servers with TURN relay' : 'ice config ready: fetched ICE servers without TURN relay';
  }
  return hasTurn ? 'ice config ready: explicit TURN relay configured' : 'ice config ready: STUN-only; restrictive networks may fail';
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

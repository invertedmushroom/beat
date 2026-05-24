// Boundary module: reads Vite env once and exposes the RTCConfiguration used
// by every RTCPeerConnection in the app. Keep env access here so the rest of
// src/net stays portable.

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

// Open Relay Project's publicly published free TURN credentials. They let
// phones on cellular / symmetric-NAT networks complete ICE when no private
// TURN is configured. Override with VITE_TURN_URL / VITE_TURN_USERNAME /
// VITE_TURN_CREDENTIAL for a private TURN deployment.
const DEFAULT_TURN_URLS = [
  'turn:openrelay.metered.ca:80',
  'turn:openrelay.metered.ca:443',
  'turn:openrelay.metered.ca:443?transport=tcp',
];
const DEFAULT_TURN_USERNAME = 'openrelayproject';
const DEFAULT_TURN_CREDENTIAL = 'openrelayproject';

function readEnv(key: string): string | undefined {
  const value = import.meta.env[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  const stun = readEnv('VITE_STUN_URL') ?? DEFAULT_STUN;
  servers.push({ urls: stun });

  const turnUrl = readEnv('VITE_TURN_URL');
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: readEnv('VITE_TURN_USERNAME'),
      credential: readEnv('VITE_TURN_CREDENTIAL'),
    });
    return servers;
  }

  if (readEnv('VITE_DISABLE_DEFAULT_TURN') !== '1') {
    servers.push({
      urls: DEFAULT_TURN_URLS,
      username: DEFAULT_TURN_USERNAME,
      credential: DEFAULT_TURN_CREDENTIAL,
    });
  }
  return servers;
}

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: buildIceServers(),
};

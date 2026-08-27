/**
 * GitHub OAuth Device Flow: sign in by entering a short code at
 * github.com/login/device — no PAT copy-paste, and no SSO-blind-token trap
 * (an OAuth App approved for the org grants org access directly). Needs a
 * registered OAuth App's client_id with "Device Flow" enabled; the client_id
 * is public (device flow has no client secret), so it ships in the app.
 *
 * Plain functions, no Electron imports — the IPC layer drives them and handles
 * showing the code to the user.
 */
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const SCOPE = 'repo read:org';

export interface DeviceCode {
  deviceCode: string;
  /** The short code the user types at the verification URL. */
  userCode: string;
  verificationUri: string;
  /** Seconds to wait between token polls. */
  interval: number;
  /** Seconds until this code expires. */
  expiresIn: number;
}

async function post(url: string, body: Record<string, string>): Promise<Record<string, string>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'pr-sweep' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);
  return (await res.json()) as Record<string, string>;
}

export async function requestDeviceCode(clientId: string): Promise<DeviceCode> {
  const b = await post(DEVICE_CODE_URL, { client_id: clientId, scope: SCOPE });
  if (b['error']) throw new Error(b['error_description'] ?? b['error']);
  return {
    deviceCode: b['device_code'],
    userCode: b['user_code'],
    verificationUri: b['verification_uri'],
    interval: Number(b['interval'] ?? 5),
    expiresIn: Number(b['expires_in'] ?? 900),
  };
}

/**
 * Polls until the user authorizes the code, then returns the access token.
 * Honors GitHub's pacing signals (authorization_pending waits, slow_down backs
 * off) and gives up when the code expires. `sleep` is injectable for tests.
 */
export async function pollForToken(
  clientId: string,
  dc: DeviceCode,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string> {
  let interval = dc.interval;
  const deadline = Date.now() + dc.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const b = await post(TOKEN_URL, {
      client_id: clientId,
      device_code: dc.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (b['access_token']) return b['access_token'];
    switch (b['error']) {
      case 'authorization_pending':
        break;
      case 'slow_down':
        interval += 5;
        break;
      case 'expired_token':
        throw new Error('The sign-in code expired. Start again.');
      case 'access_denied':
        throw new Error('Sign-in was cancelled.');
      default:
        throw new Error(b['error_description'] ?? b['error'] ?? 'Sign-in failed.');
    }
  }
  throw new Error('Sign-in timed out. Start again.');
}

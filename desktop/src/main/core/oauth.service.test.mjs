/**
 * Exercises the device-flow poll state machine against mocked GitHub responses
 * — no network, no client_id needed. Run: node src/main/core/oauth.service.test.mjs
 * (after `npm run build:main`, which emits the .js next to the source).
 */
import assert from 'node:assert';
import { pollForToken } from '../../../dist/main/main/core/oauth.service.js';

const noSleep = () => Promise.resolve();
const dc = { deviceCode: 'dc', userCode: 'ABCD-1234', verificationUri: 'x', interval: 1, expiresIn: 60 };

function mockFetch(sequence) {
  let i = 0;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => sequence[Math.min(i++, sequence.length - 1)],
  });
}

// Pending twice, then success.
mockFetch([
  { error: 'authorization_pending' },
  { error: 'authorization_pending' },
  { access_token: 'gho_ok' },
]);
assert.equal(await pollForToken('cid', dc, noSleep), 'gho_ok');

// slow_down is tolerated, then success.
mockFetch([{ error: 'slow_down' }, { access_token: 'gho_ok2' }]);
assert.equal(await pollForToken('cid', dc, noSleep), 'gho_ok2');

// access_denied surfaces a clear error.
mockFetch([{ error: 'access_denied' }]);
await assert.rejects(() => pollForToken('cid', dc, noSleep), /cancelled/i);

// expired_token surfaces a clear error.
mockFetch([{ error: 'expired_token' }]);
await assert.rejects(() => pollForToken('cid', dc, noSleep), /expired/i);

console.log('oauth.service: all device-flow poll cases pass');

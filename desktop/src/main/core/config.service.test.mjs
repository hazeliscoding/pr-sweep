/**
 * Verifies config migration + the activeProfile helper against a temp file.
 * Run after `npm run build:main`: node src/main/core/config.service.test.mjs
 */
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService, activeProfile } from '../../../dist/main/main/core/config.service.js';

const dir = mkdtempSync(join(tmpdir(), 'prsweep-cfg-'));

// A pre-v0.7 flat config migrates into a single "Default" profile.
const flat = join(dir, 'flat.json');
writeFileSync(
  flat,
  JSON.stringify({
    org: 'acme',
    authors: ['a', 'b'],
    range: { start: '2026-08-01', end: null },
    includeDrafts: true,
    staleDays: 7,
    autoRefreshMinutes: 10,
    notifications: false,
  }),
);
const migrated = new ConfigService(flat).get();
assert.equal(migrated.profiles.length, 1);
const p = activeProfile(migrated);
assert.equal(p.org, 'acme');
assert.deepEqual(p.authors, ['a', 'b']);
assert.equal(p.includeDrafts, true);
assert.equal(p.staleDays, 7);
assert.equal(migrated.autoRefreshMinutes, 10);
assert.equal(migrated.notifications, false);

// A pre-v0.6 sprint config migrates its current sprint into the range.
const sprintFile = join(dir, 'sprint.json');
writeFileSync(
  sprintFile,
  JSON.stringify({ org: 'acme', sprints: [{ start: '2000-01-01', end: '2099-01-01' }] }),
);
assert.equal(activeProfile(new ConfigService(sprintFile).get()).range.start, '2000-01-01');

// A first run (missing file) yields one default profile that is active.
const fresh = new ConfigService(join(dir, 'missing.json')).get();
assert.equal(fresh.profiles.length, 1);
assert.equal(activeProfile(fresh).id, fresh.activeProfileId);

// set() never leaves a dangling active id.
const svc = new ConfigService(join(dir, 'w.json'));
const saved = svc.set({ activeProfileId: 'nope' });
assert.equal(saved.activeProfileId, saved.profiles[0].id);

console.log('config.service: migration + activeProfile cases pass');

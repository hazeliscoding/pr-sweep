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

// Profiles from before v0.12 get no sprint schedule and keep their custom range.
{
  const file = join(dir, 'v011.json');
  writeFileSync(
    file,
    JSON.stringify({
      profiles: [{ id: 'a', name: 'A', org: 'acme', authors: [], range: { start: '2026-09-01', end: null }, includeDrafts: false, staleDays: 5 }],
      activeProfileId: 'a',
    }),
  );
  const prof = activeProfile(new ConfigService(file).get());
  assert.strictEqual(prof.sprints, null);
  assert.equal(prof.period, 'custom');
  assert.deepEqual(prof.range, { start: '2026-09-01', end: null }, 'range untouched');
}

// A sprint schedule and a pinned period round-trip; broken ones fall back safely.
{
  const sprints = { pattern: 'Sprint {n}', first: { number: 24, start: '2026-09-14' }, lengthDays: 14, lengths: { 30: 21 }, names: { 30: 'Holiday sprint' } };
  const file = join(dir, 'sprints.json');
  const svc2 = new ConfigService(file);
  svc2.set({ profiles: [{ ...activeProfile(svc2.get()), sprints, period: { sprint: 25 } }] });
  const back = activeProfile(new ConfigService(file).get());
  assert.deepEqual(back.sprints, sprints);
  assert.deepEqual(back.period, { sprint: 25 });

  const broken = join(dir, 'broken.json');
  writeFileSync(
    broken,
    JSON.stringify({
      profiles: [
        { id: 'b', name: 'B', org: 'acme', authors: [], range: { start: '2026-09-01', end: null }, sprints: { ...sprints, lengthDays: 0 }, period: { sprint: 'x' } },
      ],
      activeProfileId: 'b',
    }),
  );
  const fixed = activeProfile(new ConfigService(broken).get());
  assert.strictEqual(fixed.sprints, null, 'a zero-length sprint schedule is dropped');
  assert.equal(fixed.period, 'custom', 'an unreadable period falls back to the custom range');
}

console.log('config.service: migration + activeProfile cases pass');

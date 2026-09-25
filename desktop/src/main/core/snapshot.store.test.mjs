/**
 * Verifies the snapshot cache only hands back sweeps in the current schema.
 * Run after `npm run build:main`: node src/main/core/snapshot.store.test.mjs
 */
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SnapshotStore } from '../../../dist/main/main/core/snapshot.store.js';
import { SWEEP_SCHEMA } from '../../../dist/main/shared/types.js';

const dir = mkdtempSync(join(tmpdir(), 'prsweep-snap-'));
const sweep = (extra) => ({
  fetchedAt: '2026-09-25T00:00:00Z',
  org: 'acme',
  range: { start: '2026-09-01', end: null },
  open: [],
  merged: [],
  queue: [],
  ...extra,
});

// A snapshot written by v0.10.x has no schema — its rows lack newer fields, so
// it must not be painted or patched.
{
  const file = join(dir, 'old.json');
  writeFileSync(file, JSON.stringify(sweep()));
  assert.strictEqual(new SnapshotStore(file).get(), null, 'unversioned snapshot is ignored');
}

// An older schema number is ignored too.
{
  const file = join(dir, 'older.json');
  writeFileSync(file, JSON.stringify(sweep({ schema: SWEEP_SCHEMA - 1 })));
  assert.strictEqual(new SnapshotStore(file).get(), null, 'older schema is ignored');
}

// The current schema round-trips.
{
  const store = new SnapshotStore(join(dir, 'current.json'));
  const current = sweep({ schema: SWEEP_SCHEMA });
  store.set(current);
  assert.deepStrictEqual(store.get(), current);
}

// Missing and corrupt files stay a quiet cache miss.
{
  assert.strictEqual(new SnapshotStore(join(dir, 'missing.json')).get(), null);
  const file = join(dir, 'corrupt.json');
  writeFileSync(file, '{not json');
  assert.strictEqual(new SnapshotStore(file).get(), null);
}

console.log('snapshot.store: schema gating and cache-miss cases pass');

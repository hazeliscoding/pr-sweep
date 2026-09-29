/**
 * Verifies the sprint schedule: numbering and dates (last day included),
 * one-off lengths shifting later sprints, renames, which sprint holds a date,
 * and resolving a profile's period to what the board shows.
 * Run after `npm run build:main`: node src/main/core/sprints.test.mjs
 */
import assert from 'node:assert';
import { resolvePeriod, sprintAt, sprintOn, sprintsAround } from '../../../dist/main/main/core/sprints.js';

const schedule = (patch = {}) => ({
  pattern: 'Sprint {n}',
  first: { number: 24, start: '2026-09-14' },
  lengthDays: 14,
  lengths: {},
  names: {},
  ...patch,
});

// --- numbering and dates, last day included ---
assert.deepEqual(sprintAt(schedule(), 24), { number: 24, name: 'Sprint 24', start: '2026-09-14', end: '2026-09-27' });
assert.deepEqual(sprintAt(schedule(), 25), { number: 25, name: 'Sprint 25', start: '2026-09-28', end: '2026-10-11' });
assert.strictEqual(sprintAt(schedule(), 23), null, 'nothing before the first sprint');
assert.equal(sprintAt(schedule(), 60).start, '2028-01-31', '36 sprints later, across two DST changes, still exact');

// --- a one-off length shifts every later sprint ---
{
  const s = schedule({ lengths: { 25: 21 } });
  assert.deepEqual(sprintAt(s, 25), { number: 25, name: 'Sprint 25', start: '2026-09-28', end: '2026-10-18' });
  assert.equal(sprintAt(s, 26).start, '2026-10-19');
  assert.equal(sprintAt(s, 26).end, '2026-11-01', 'back to the usual length');
}

// --- a one-off name ---
assert.equal(sprintAt(schedule({ names: { 25: 'Holiday sprint' } }), 25).name, 'Holiday sprint');
assert.equal(sprintAt(schedule({ pattern: 'Iteration {n}' }), 30).name, 'Iteration 30');

// --- which sprint holds a date ---
assert.equal(sprintOn(schedule(), '2026-09-27').number, 24, 'last day belongs to the sprint');
assert.equal(sprintOn(schedule(), '2026-09-28').number, 25, 'the next day starts the next one');
assert.strictEqual(sprintOn(schedule(), '2026-09-13'), null, 'before the schedule');

// --- resolving a profile's period ---
const profile = (patch = {}) => ({
  id: 'p',
  name: 'Team',
  org: 'acme',
  authors: [],
  range: { start: '2026-09-17', end: '2026-10-01' },
  includeDrafts: false,
  staleDays: 5,
  sprints: schedule(),
  period: 'current',
  ...patch,
});
const TODAY = '2026-09-29';

{
  const p = resolvePeriod(profile(), TODAY);
  assert.equal(p.kind, 'sprint');
  assert.equal(p.sprint.number, 25);
  assert.equal(p.isCurrent, true);
  assert.deepEqual(p.range, { start: '2026-09-28', end: '2026-10-11' });
  assert.equal(p.label, 'Sprint 25 · Sep 28 – Oct 11');
  assert.equal(p.previous.number, 24);
  assert.equal(p.next.number, 26);
  assert.equal(p.current.number, 25);
  assert.equal(p.hasSchedule, true);
}

{
  const p = resolvePeriod(profile({ period: { sprint: 24 } }), TODAY);
  assert.equal(p.sprint.number, 24);
  assert.equal(p.isCurrent, false, 'a pinned past sprint');
  assert.equal(p.current.number, 25, 'the current one is still known, for "Current"');
  assert.equal(p.label, 'Sprint 24 · Sep 14–27', 'same month: one month name');
  assert.strictEqual(p.previous, null, 'nothing before the first sprint');
}

{
  const p = resolvePeriod(profile({ period: 'custom' }), TODAY);
  assert.equal(p.kind, 'custom');
  assert.deepEqual(p.range, { start: '2026-09-17', end: '2026-10-01' });
  assert.equal(p.label, 'Sep 17 – Oct 1');
  assert.strictEqual(p.sprint, null);
  assert.equal(p.hasSchedule, true);
}

{
  const p = resolvePeriod(profile({ period: 'custom', range: { start: '2026-09-17', end: null } }), TODAY);
  assert.equal(p.label, 'Since Sep 17', 'open-ended custom range');
}

{
  const p = resolvePeriod(profile({ sprints: null }), TODAY);
  assert.equal(p.kind, 'custom', 'no schedule: the custom range, whatever the period says');
  assert.equal(p.hasSchedule, false);
}

{
  const p = resolvePeriod(profile({ sprints: schedule({ first: { number: 1, start: '2026-10-05' } }) }), TODAY);
  assert.equal(p.sprint.number, 1, 'before the schedule starts, "current" shows the first sprint');
  assert.equal(p.isCurrent, false);
  assert.strictEqual(p.current, null);
}

{
  const p = resolvePeriod(profile({ sprints: schedule({ first: { number: 1, start: '2026-12-21' } }), period: { sprint: 2 } }), TODAY);
  assert.equal(p.label, 'Sprint 2 · Jan 4–17, 2027', 'the year shows when it isn’t this one');
}

// --- the editor's preview: two back, three ahead, never before the first ---
{
  const p = sprintsAround(schedule({ first: { number: 20, start: '2026-07-20' } }), TODAY);
  assert.equal(p.current, 25);
  assert.deepEqual(p.sprints.map((s) => s.number), [23, 24, 25, 26, 27, 28]);
  assert.equal(p.sprints[2].start, '2026-09-28');
  assert.equal(p.sprints[2].dates, 'Sep 28 – Oct 11');
  assert.equal(p.sprints[2].days, 14);
}
{
  const p = sprintsAround(schedule(), TODAY);
  assert.deepEqual(p.sprints.map((s) => s.number), [24, 25, 26, 27, 28], 'clipped at the first sprint');
}
{
  const p = sprintsAround(schedule({ first: { number: 1, start: '2026-10-05' } }), TODAY);
  assert.strictEqual(p.current, null, 'not started yet');
  assert.deepEqual(p.sprints.map((s) => s.number), [1, 2, 3, 4], 'the first few');
}
{
  const p = sprintsAround(schedule({ names: { 26: 'Launch' }, lengths: { 25: 7 } }), TODAY);
  assert.equal(p.sprints[2].name, 'Launch', 'overrides show in the preview');
  assert.equal(p.sprints[2].start, '2026-10-05', 'and so do shifted dates');
  assert.equal(p.sprints[1].days, 7);
}

console.log('sprints: schedule math, current sprint, period resolution and preview pass');

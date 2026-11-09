import assert from 'node:assert';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Entry } from '../lib/storage';
import { entryDuration, finishTask, getEntries, getPaused, getProjects, getRunning, pauseTask, reportDuration, resumeTask, segmentsInRange, setPublicDuration, startTask } from '../lib/storage';
import { getRange } from '../lib/time';
import { enqueue, reset, state } from './chrome-mock';

function find(entries: Entry[], id: string) {
  const entry = entries.find(item => item.id === id);
  assert(entry, `expected entry ${id} to exist`);
  return entry;
}

async function testPauseFreezesTime() {
  const task = await startTask(' Задача A ', '', 'P1');
  assert(task.title === 'Задача A', 'expected the title to be trimmed');
  assert(task.user_email === 'me@example.com', 'expected the entry to belong to the signed-in person');

  await sleep(30);
  await pauseTask(task.id);
  const paused = await getPaused();
  const frozen = entryDuration(paused[0], null, Date.now());
  await sleep(40);
  const later = await getPaused();
  assert(entryDuration(later[0], null, Date.now()) === frozen, 'expected a paused task not to count time');

  await resumeTask(task.id);
  const entries = await getEntries();
  assert(find(entries, task.id).segments.length === 2, 'expected resume to add a segment');
}

async function testOnlyOneRunning() {
  const first = await startTask('A', '', '');
  const second = await startTask('B', '', '');
  let entries = await getEntries();
  assert(find(entries, first.id).status === 'paused', 'expected starting B to pause A');
  const running = await getRunning();
  assert(running?.id === second.id, 'expected B to be running');

  await resumeTask(first.id);
  entries = await getEntries();
  assert(find(entries, second.id).status === 'paused', 'expected resuming A to pause B');

  await finishTask(first.id);
  entries = await getEntries();
  const finished = find(entries, first.id);
  assert(finished.status === 'done', 'expected A to be done');
  assert(finished.segments.every(segment => segment.end !== null), 'expected every segment of a done task to be closed');
}

async function testOtherPeopleAreHidden() {
  await startTask('Mine', '', 'P1');
  state.email = 'other@example.com';
  const theirs = await getEntries();
  assert(theirs.length === 0, 'expected another account not to see my entries');
  state.email = '';
  await startTask('Offline', '', '');
  const local = await getEntries();
  assert(local.length === 1 && local[0].user_email === 'local', 'expected entries without sign-in to be stored as local');
  const projects = await getProjects();
  assert(!projects.includes('P1'), 'expected project names from other accounts to stay hidden');
}

async function testLegacyEntriesUpgrade() {
  state.storage.set('entries', [{
    createdAt: 1,
    description: '',
    id: 'old',
    project: '',
    segments: [{ end: null, start: Date.now() - 60000 }],
    status: 'running',
    title: 'From version 1',
    updatedAt: 1,
    userEmail: 'me@example.com'
  }]);

  const entries = await getEntries();
  assert(entries.length === 1 && entries[0].user_email === 'me@example.com', 'expected a version 1 entry to be read');
  await pauseTask('old');
  const stored = <Record<string, unknown>[]>state.storage.get('entries');
  assert(stored[0].user_email === 'me@example.com' && !('userEmail' in stored[0]), 'expected the next write to save the new shape');
}

function testSplitByDay() {
  const entry: Entry = {
    created_at: 1,
    description: '',
    id: 'x',
    project: '',
    public_duration: null,
    segments: [
      { end: new Date(2026, 10, 10, 10).getTime(), start: new Date(2026, 10, 10, 9).getTime() },
      { end: new Date(2026, 10, 11, 9, 30).getTime(), start: new Date(2026, 10, 11, 9).getTime() }
    ],
    status: 'done',
    title: 'x',
    updated_at: 1,
    user_email: 'me@example.com'
  };
  assert(entryDuration(entry, null, Date.now()) === 90 * 60000, 'expected 1.5 hours in total');
  const day = getRange('today', '', '', new Date(2026, 10, 11, 12));
  assert(day !== null, 'expected a range');
  assert(segmentsInRange(entry, day).length === 1, 'expected one segment on the second day');
  assert(entryDuration(entry, day, Date.now()) === 30 * 60000, 'expected only the second day to count');
}

/**
 * A done task worked on for an hour on November 10 and an hour on November 11.
 */
function twoDayTask(publicDuration: number | null) {
  const entry: Entry = {
    created_at: 1,
    description: '',
    id: 'two-days',
    project: '',
    public_duration: publicDuration,
    segments: [
      { end: new Date(2026, 10, 10, 10).getTime(), start: new Date(2026, 10, 10, 9).getTime() },
      { end: new Date(2026, 10, 11, 10).getTime(), start: new Date(2026, 10, 11, 9).getTime() }
    ],
    status: 'done',
    title: 'Two days',
    updated_at: 1,
    user_email: 'me@example.com'
  };
  return entry;
}

function testReportDuration() {
  const monday = getRange('today', '', '', new Date(2026, 10, 10, 12));
  const tuesday = getRange('today', '', '', new Date(2026, 10, 11, 12));
  const week = getRange('week', '', '', new Date(2026, 10, 11, 12));
  assert(monday !== null && tuesday !== null && week !== null, 'expected ranges');
  const now = Date.now();
  const hour = 3600000;

  const tracked = twoDayTask(null);
  assert(reportDuration(tracked, monday, now) === hour, 'expected tracked time without public time');

  const reported = twoDayTask(3 * hour);
  assert(reportDuration(reported, monday, now) === 1.5 * hour, 'expected half of the public time on the first day');
  assert(reportDuration(reported, tuesday, now) === 1.5 * hour, 'expected half of the public time on the second day');
  assert(reportDuration(reported, week, now) === 3 * hour, 'expected all the public time over the week');
  assert(reportDuration(reported, null, now) === 3 * hour, 'expected all the public time without a range');

  const instant = twoDayTask(hour);
  instant.segments = [{ end: new Date(2026, 10, 10, 9).getTime(), start: new Date(2026, 10, 10, 9).getTime() }];
  assert(reportDuration(instant, monday, now) === hour, 'expected public time on the day a zero-length task started');
  assert(reportDuration(instant, tuesday, now) === 0, 'expected nothing on other days for a zero-length task');
}

async function testSetPublicDuration() {
  const task = await startTask('Задача', '', '');
  let entries = await getEntries();
  assert(find(entries, task.id).public_duration === null, 'expected a new task to have no public time');
  await setPublicDuration(task.id, 45 * 60000);
  entries = await getEntries();
  assert(find(entries, task.id).public_duration === 45 * 60000, 'expected public time to be saved');
  await setPublicDuration(task.id, null);
  entries = await getEntries();
  assert(find(entries, task.id).public_duration === null, 'expected public time to be cleared');
}

async function testEntriesWithoutPublicTime() {
  state.storage.set('entries', [{
    created_at: 1,
    description: '',
    id: 'before',
    project: '',
    segments: [{ end: 2000, start: 1000 }],
    status: 'done',
    title: 'Saved before public time existed',
    updated_at: 1,
    user_email: 'me@example.com'
  }]);
  const entries = await getEntries();
  assert(entries[0].public_duration === null, 'expected a missing public time to read as null');
}

async function main() {
  await testPauseFreezesTime();
  reset();
  await testOnlyOneRunning();
  reset();
  await testOtherPeopleAreHidden();
  reset();
  await testLegacyEntriesUpgrade();
  reset();
  await testSetPublicDuration();
  reset();
  await testEntriesWithoutPublicTime();
  testSplitByDay();
  testReportDuration();
}

enqueue('storage', main);

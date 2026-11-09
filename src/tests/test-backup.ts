import assert from 'node:assert';
import { createBackup, deleteEntry, getEntries, getProjects, pauseTask, restoreBackup, startTask, updateEntry } from '../lib/storage';
import { enqueue, reset, state } from './chrome-mock';

async function testRoundTrip() {
  const first = await startTask('A', '', 'P1');
  await pauseTask(first.id);
  const second = await startTask('B', 'описание', 'P2');
  const created = await createBackup();
  const backup: unknown = JSON.parse(JSON.stringify(created));

  // Reinstalling the extension starts from empty storage.
  state.storage.clear();
  let result = await restoreBackup(backup);
  assert(result.added === 2 && result.updated === 0, 'expected everything to be added to empty storage');
  let entries = await getEntries();
  assert(entries.find(entry => entry.id === second.id)?.status === 'running', 'expected the running task to come back running');
  const projects = await getProjects();
  assert(projects.join() === 'P1,P2', 'expected projects to come back');

  result = await restoreBackup(backup);
  assert(result.added === 0 && result.unchanged === 2, 'expected a second restore to change nothing');

  await updateEntry(first.id, { description: '', project: 'P1', segments: entries[0].segments, status: 'paused', title: 'A edited' });
  await restoreBackup(backup);
  entries = await getEntries();
  assert(entries.find(entry => entry.id === first.id)?.title === 'A edited', 'expected a newer local edit to win');

  // B comes back as running although C is running now, and only one of them may run.
  const third = await startTask('C', '', '');
  await deleteEntry(second.id);
  await restoreBackup(backup);
  entries = await getEntries();
  const running = entries.filter(entry => entry.status === 'running');
  assert(running.length === 1 && running[0].id === third.id, 'expected only the most recently started task to keep running');
}

async function testMovesToCurrentAccount() {
  await startTask('A', '', '');
  const backup = await createBackup();
  state.storage.clear();
  state.email = 'new@example.com';
  const result = await restoreBackup(backup);
  const entries = await getEntries();
  assert(result.added === 1 && entries[0].user_email === 'new@example.com', 'expected restored entries to belong to the signed-in account');
}

async function testVersionOneBackup() {
  const backup = {
    app: 'time-tracker',
    entries: [{
      createdAt: 1000,
      description: '',
      id: 'v1',
      project: 'Old',
      segments: [{ end: 2000, start: 1000 }],
      status: 'done',
      title: 'From version 1',
      updatedAt: 2000,
      userEmail: 'me@example.com'
    }],
    exportedAt: '2026-11-09T00:00:00.000Z',
    projects: ['Old'],
    user: 'me@example.com',
    version: 1
  };
  const result = await restoreBackup(backup);
  const entries = await getEntries();
  assert(result.added === 1 && entries[0].created_at === 1000, 'expected a version 1 backup to restore');
}

async function testRejectsBadInput() {
  let rejected = false;
  try {
    await restoreBackup({ foo: 1 });
  } catch (error) {
    rejected = error instanceof Error;
  }
  assert(rejected, 'expected a file from something else to be rejected');

  const result = await restoreBackup({
    app: 'time-tracker',
    entries: [
      { created_at: 1, description: '', id: 'empty', project: '', segments: [], status: 'done', title: 'No segments', updated_at: 1 },
      { created_at: 1, description: '', id: 'overlap', project: '', segments: [{ end: 30, start: 10 }, { end: 40, start: 20 }], status: 'done', title: 'Overlap', updated_at: 1 },
      'garbage'
    ],
    version: 2
  });
  assert(result.invalid === 3 && result.added === 0, 'expected broken entries to be skipped');
}

async function main() {
  await testRoundTrip();
  reset();
  await testMovesToCurrentAccount();
  reset();
  await testVersionOneBackup();
  reset();
  await testRejectsBadInput();
}

enqueue('backup', main);

import assert from 'node:assert';
import { getSettings, setHiddenColumns } from '../lib/settings';
import { createBackup, restoreBackup } from '../lib/storage';
import { enqueue, reset, state } from './chrome-mock';

const known = ['date', 'project', 'status', 'end'];

async function testDefaults() {
  const settings = await getSettings();
  assert(settings.hidden_columns.length === 0, 'expected every column to show by default');
}

async function testSaveAndRead() {
  await setHiddenColumns(['status', 'end', 'status', 'unknown'], known);
  const settings = await getSettings();
  assert(settings.hidden_columns.join() === 'status,end', 'expected known columns to be saved once each');

  await setHiddenColumns([], known);
  const cleared = await getSettings();
  assert(cleared.hidden_columns.length === 0, 'expected columns to show again');
}

async function testPerAccount() {
  await setHiddenColumns(['date'], known);
  state.email = 'other@example.com';
  const other = await getSettings();
  assert(other.hidden_columns.length === 0, 'expected another account not to get my settings');
  await setHiddenColumns(['project'], known);
  state.email = 'me@example.com';
  const mine = await getSettings();
  assert(mine.hidden_columns.join() === 'date', 'expected my settings to stay mine');
}

async function testBackup() {
  await setHiddenColumns(['end'], known);
  const created = await createBackup();
  const backup: unknown = JSON.parse(JSON.stringify(created));

  state.storage.clear();
  state.email = 'new@example.com';
  await restoreBackup(backup);
  let settings = await getSettings();
  assert(settings.hidden_columns.join() === 'end', 'expected settings to come back for the signed-in account');

  // A newer choice made here wins over the one in the file.
  await setHiddenColumns(['date'], known);
  await restoreBackup(backup);
  settings = await getSettings();
  assert(settings.hidden_columns.join() === 'date', 'expected a newer local choice to win');

  await restoreBackup({ app: 'time-tracker', entries: [], settings: { hidden_columns: 'garbage', updated_at: Date.now() + 1000 }, version: 4 });
  settings = await getSettings();
  assert(settings.hidden_columns.join() === 'date', 'expected broken settings to be skipped');

  await restoreBackup({ app: 'time-tracker', entries: [], version: 3 });
  settings = await getSettings();
  assert(settings.hidden_columns.join() === 'date', 'expected a backup without settings to leave them alone');
}

async function main() {
  await testDefaults();
  reset();
  await testSaveAndRead();
  reset();
  await testPerAccount();
  reset();
  await testBackup();
}

enqueue('settings', main);

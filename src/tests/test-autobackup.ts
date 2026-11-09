import { subDays } from 'date-fns';
import assert from 'node:assert';
import * as autobackup from '../lib/autobackup';
import { startTask } from '../lib/storage';
import { enqueue, reset, state } from './chrome-mock';

/**
 * Moves the last backup two days into the past, so the next run sees one as due.
 */
async function pretendTimePassed() {
  const meta = await autobackup.getMeta();
  state.storage.set('auto_backup', { ...meta, last_at: subDays(new Date(), 2).getTime() });
}

async function testDailyBackups() {
  let result = await autobackup.run();
  assert(result === 'empty', 'expected no backup without entries');

  await startTask('Задача', '', '');
  result = await autobackup.run();
  assert(result === 'saved', 'expected the first backup to be saved');
  const download = state.downloads[0];
  assert(download.filename?.startsWith('time-tracker-backups/time-tracker-backup_'), 'expected the backup folder');
  assert(download.saveAs === false, 'expected no save dialog');
  const backup = <{ entries: unknown[]; }>JSON.parse(decodeURIComponent(download.url.slice(download.url.indexOf(',') + 1)));
  assert(backup.entries.length === 1, 'expected the file to hold the entry');

  result = await autobackup.run();
  assert(result === 'recent', 'expected no second backup on the same day');

  await pretendTimePassed();
  result = await autobackup.run();
  assert(result === 'unchanged', 'expected no backup when nothing changed');
}

async function testKeepsFourteen() {
  for (let index = 0; index < 17; index++) {
    await startTask(`Задача ${index}`, '', '');
    await pretendTimePassed();
    await autobackup.run();
  }
  const meta = await autobackup.getMeta();
  assert(state.downloads.length === 17, 'expected a backup for every change');
  assert(meta.files.length === 14, 'expected 14 files to be kept');
  assert(state.removed.join() === '1,2,3', 'expected the three oldest files to be deleted');
  assert(state.erased.join() === '1,2,3', 'expected the three oldest files to leave the download history');
}

async function testDisabled() {
  await startTask('Задача', '', '');
  await autobackup.setEnabled(false);
  const result = await autobackup.run();
  assert(result === 'disabled', 'expected nothing to happen when turned off');
}

async function testVersionOneSettings() {
  state.storage.set('autoBackup', { enabled: false, files: [{ at: 1, id: 5 }], lastAt: 1, lastHash: 'x', lastId: 5 });
  const meta = await autobackup.getMeta();
  assert(!meta.enabled && meta.last_id === 5 && meta.files.length === 1, 'expected version 1 settings to be read');
  await autobackup.setEnabled(true);
  assert(state.storage.has('auto_backup') && !state.storage.has('autoBackup'), 'expected the settings to move to the new key');
}

async function main() {
  await testDailyBackups();
  reset();
  await testKeepsFourteen();
  reset();
  await testDisabled();
  reset();
  await testVersionOneSettings();
}

enqueue('autobackup', main);

import { addDays, format, isBefore } from 'date-fns';
import { createBackup } from './storage';

// A daily backup into Downloads/time-tracker-backups. The service worker checks every hour and
// writes a file only when the last one is more than a day old and the data changed since then.
// We keep the newest 14 files and delete older ones that this extension downloaded.
//
// Version 1 kept this state under the camelCase key "autoBackup". We still read it, and the
// first save moves it to "auto_backup".

/**
 * A backup file this extension downloaded.
 */
interface SavedFile {
  /**
   * When the file was saved, in milliseconds since the epoch.
   */
  at: number;

  /**
   * The id Chrome gave the download.
   */
  id: number;
}

interface Meta {
  enabled: boolean;

  /**
   * Oldest first.
   */
  files: SavedFile[];

  last_at: number | null;

  /**
   * Why the last attempt failed, or null when it worked.
   */
  last_error: string | null;

  /**
   * Fingerprint of the data in the last backup.
   */
  last_hash: string | null;

  last_id: number | null;
}

interface LegacyMeta {
  enabled?: boolean;

  files?: SavedFile[];

  lastAt?: number;

  lastError?: string | null;

  lastHash?: string;

  lastId?: number;
}

export async function getMeta() {
  const items = await chrome.storage.local.get(['auto_backup', 'autoBackup']);
  const stored = <Meta | undefined>items.auto_backup;
  if (stored) {
    return stored;
  }

  const legacy = <LegacyMeta | undefined>items.autoBackup;
  const meta: Meta = {
    enabled: legacy?.enabled ?? true,
    files: legacy?.files ?? [],
    last_at: legacy?.lastAt ?? null,
    last_error: legacy?.lastError ?? null,
    last_hash: legacy?.lastHash ?? null,
    last_id: legacy?.lastId ?? null
  };
  return meta;
}

async function save(meta: Meta) {
  await chrome.storage.local.set({ auto_backup: meta });
  return chrome.storage.local.remove('autoBackup');
}

export async function setEnabled(enabled: boolean) {
  const meta = await getMeta();
  return save({ ...meta, enabled });
}

/**
 * A cheap fingerprint of the backed up data, so we can skip a backup when nothing changed.
 */
function fingerprint(data: unknown[]) {
  const text = JSON.stringify(data);
  let hash = 5381;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${hash >>> 0}:${text.length}`;
}

/**
 * Saves a backup file when one is due, and says what happened.
 */
export async function run() {
  const meta = await getMeta();
  if (!meta.enabled) {
    return 'disabled';
  }

  const now = new Date();
  if (meta.last_at !== null && isBefore(now, addDays(meta.last_at, 1))) {
    return 'recent';
  }

  const backup = await createBackup();
  if (backup.entries.length === 0 && backup.invoices.length === 0) {
    return 'empty';
  }

  // The export time changes on every call, so it stays out of the fingerprint.
  const hash = fingerprint([backup.user, backup.entries, backup.projects, backup.payees, backup.clients, backup.invoices, backup.settings]);
  if (hash === meta.last_hash) {
    return 'unchanged';
  }

  let id: number;
  try {
    id = await download(backup, now);
  } catch (error) {
    console.warn(error);
    await save({ ...meta, last_error: error instanceof Error ? error.message : 'Unknown error' });
    return 'failed';
  }

  const files = [...meta.files, { at: now.getTime(), id }];
  const keep = files.slice(-14);
  await removeFiles(files.slice(0, files.length - keep.length));
  await save({
    enabled: meta.enabled,
    files: keep,
    last_at: now.getTime(),
    last_error: null,
    last_hash: hash,
    last_id: id
  });
  return 'saved';
}

function download(backup: unknown, now: Date) {
  // A service worker has no URL.createObjectURL, so the file goes to Chrome as a data URL.
  const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backup));
  return chrome.downloads.download({
    conflictAction: 'uniquify',
    filename: `time-tracker-backups/time-tracker-backup_${format(now, 'yyyy-MM-dd_HH-mm')}.json`,
    saveAs: false,
    url
  });
}

async function removeFiles(files: SavedFile[]) {
  for (const file of files) {
    try {
      await chrome.downloads.removeFile(file.id);
    } catch (error) {
      // The person may have moved or deleted the file already, which is fine.
      console.debug('Old backup file is already gone', file, error);
    }
    await chrome.downloads.erase({ id: file.id });
  }
}

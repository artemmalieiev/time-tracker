import { getBackupData, restore as restoreInvoices } from './invoices';
import { getSettings, restore as restoreSettings } from './settings';
import type { Range } from './time';
import { getKey } from './user';

// Entries live in chrome.storage.local. Every entry belongs to one person, and every read and
// write here only sees the entries of whoever is signed in to Chrome right now. Project names come
// from those entries too, so one account never sees another account's projects.
//
// Version 1 of the extension was plain JavaScript and stored entries with camelCase keys. We
// still read that shape, and the next write of the entries saves them in the current shape.

/**
 * One stretch of uninterrupted work. Times are milliseconds since the epoch.
 */
export interface Segment {
  /**
   * Null while the task is being worked on right now. Only the last segment can be open.
   */
  end: number | null;

  start: number;
}

export type Status = 'done' | 'paused' | 'running';

export interface Entry {
  created_at: number;

  description: string;

  id: string;

  /**
   * Empty when the task has no project.
   */
  project: string;

  /**
   * Time in milliseconds the person chose to report instead of the tracked time, or null to report
   * the tracked time.
   */
  public_duration: number | null;

  /**
   * In chronological order.
   */
  segments: Segment[];

  status: Status;

  title: string;

  updated_at: number;

  /**
   * The email of the owner, or "local" for entries made while Chrome was not signed in.
   */
  user_email: string;
}

/**
 * How an entry looked in version 1.
 */
interface LegacyEntry {
  createdAt: number;

  description: string;

  id: string;

  project: string;

  segments: Segment[];

  status: Status;

  title: string;

  updatedAt: number;

  userEmail: string;
}

/**
 * The fields a person fills in when creating or editing an entry.
 */
interface Draft {
  description: string;

  project: string;

  public_duration: number | null;

  segments: Segment[];

  status: Status;

  title: string;
}

function isLegacyEntry(value: any): value is LegacyEntry {
  return typeof value === 'object'
    && value !== null
    && typeof value.userEmail === 'string';
}

function upgrade(entry: Entry | LegacyEntry) {
  if (!isLegacyEntry(entry)) {
    // Entries saved before public time existed have no such field, and they report tracked time.
    const current: Entry = { ...entry, public_duration: entry.public_duration ?? null };
    return current;
  }

  const upgraded: Entry = {
    created_at: entry.createdAt,
    description: entry.description,
    id: entry.id,
    project: entry.project,
    public_duration: null,
    segments: entry.segments,
    status: entry.status,
    title: entry.title,
    updated_at: entry.updatedAt,
    user_email: entry.userEmail
  };
  return upgraded;
}

/**
 * Every stored entry of every person.
 */
async function readAll() {
  const items = await chrome.storage.local.get('entries');
  const stored = <(Entry | LegacyEntry)[] | undefined>items.entries;
  const entries: Entry[] = [];
  for (const entry of stored ?? []) {
    entries.push(upgrade(entry));
  }
  return entries;
}

// Writes go through a queue so that two quick clicks cannot read the same entries and then
// overwrite each other's change.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Reads all entries, lets the change edit them in place, then saves them.
 */
function mutate<T>(change: (entries: Entry[], user: string, now: number) => T) {
  const run = queue.then(async function applyChange() {
    const entries = await readAll();
    const user = await getKey();
    const result = change(entries, user, Date.now());
    await chrome.storage.local.set({ entries });
    return result;
  });
  queue = run.catch(function keepQueueAlive(error) {
    console.debug('Queued storage write failed', error);
  });
  return run;
}

function closeOpenSegment(entry: Entry, now: number) {
  const last = entry.segments.at(-1);
  if (last && last.end === null) {
    last.end = Math.max(now, last.start);
  }
}

/**
 * Only one task can be running at a time, so we pause every other running task of this person.
 */
function pauseOthers(entries: Entry[], user: string, now: number, exceptId: string | null) {
  for (const entry of entries) {
    if (entry.user_email !== user) {
      continue;
    }
    if (entry.status !== 'running') {
      continue;
    }
    if (entry.id === exceptId) {
      continue;
    }
    closeOpenSegment(entry, now);
    entry.status = 'paused';
    entry.updated_at = now;
  }
}

function findOwn(entries: Entry[], user: string, id: string) {
  for (const entry of entries) {
    if (entry.id === id && entry.user_email === user) {
      return entry;
    }
  }
  throw new Error('Задача не найдена');
}

function lastActivity(entry: Entry) {
  const last = entry.segments.at(-1);
  if (!last) {
    return entry.created_at;
  }
  return last.end ?? Date.now();
}

/**
 * Entries of the person signed in to Chrome.
 */
export async function getEntries() {
  const entries = await readAll();
  const user = await getKey();
  return entries.filter(entry => entry.user_email === user);
}

export async function getRunning() {
  const entries = await getEntries();
  return entries.find(entry => entry.status === 'running') ?? null;
}

/**
 * Paused entries, the most recently worked on first.
 */
export async function getPaused() {
  const entries = await getEntries();
  const paused = entries.filter(entry => entry.status === 'paused');
  paused.sort((a, b) => lastActivity(b) - lastActivity(a));
  return paused;
}

/**
 * Creates a task and starts its timer. Whatever was running before goes on pause.
 */
export function startTask(title: string, description: string, project: string) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new Error('Название обязательно');
  }

  return mutate(function start(entries, user, now) {
    pauseOthers(entries, user, now, null);
    const created: Entry = {
      created_at: now,
      description: description.trim(),
      id: crypto.randomUUID(),
      project: project.trim(),
      public_duration: null,
      segments: [{ end: null, start: now }],
      status: 'running',
      title: trimmedTitle,
      updated_at: now,
      user_email: user
    };
    entries.push(created);
    return created;
  });
}

export function pauseTask(id: string) {
  return mutate(function pause(entries, user, now) {
    const entry = findOwn(entries, user, id);
    if (entry.status === 'running') {
      closeOpenSegment(entry, now);
      entry.status = 'paused';
      entry.updated_at = now;
    }
  });
}

/**
 * Starts a new segment of work on a paused or finished task.
 */
export function resumeTask(id: string) {
  return mutate(function resume(entries, user, now) {
    const entry = findOwn(entries, user, id);
    if (entry.status !== 'running') {
      pauseOthers(entries, user, now, id);
      entry.segments.push({ end: null, start: now });
      entry.status = 'running';
      entry.updated_at = now;
    }
  });
}

/**
 * Stops the task for good and returns it as saved, with its last segment closed.
 */
export function finishTask(id: string) {
  return mutate(function finish(entries, user, now) {
    const entry = findOwn(entries, user, id);
    closeOpenSegment(entry, now);
    entry.status = 'done';
    entry.updated_at = now;
    return entry;
  });
}

/**
 * Adds an entry typed in by hand. The caller has already validated the segments.
 */
export function addEntry(draft: Draft) {
  return mutate(function add(entries, user, now) {
    if (draft.status === 'running') {
      pauseOthers(entries, user, now, null);
    }
    entries.push({
      created_at: now,
      description: draft.description.trim(),
      id: crypto.randomUUID(),
      project: draft.project.trim(),
      public_duration: draft.public_duration,
      segments: draft.segments,
      status: draft.status,
      title: draft.title.trim(),
      updated_at: now,
      user_email: user
    });
  });
}

/**
 * Replaces everything a person can edit on an entry. The caller has already validated the
 * segments.
 */
export function updateEntry(id: string, draft: Draft) {
  return mutate(function update(entries, user, now) {
    const entry = findOwn(entries, user, id);
    if (draft.status === 'running') {
      pauseOthers(entries, user, now, id);
    }
    entry.description = draft.description.trim();
    entry.project = draft.project.trim();
    entry.public_duration = draft.public_duration;
    entry.segments = draft.segments;
    entry.status = draft.status;
    entry.title = draft.title.trim();
    entry.updated_at = now;
  });
}

/**
 * Sets the time to report for a task, or clears it with null so the tracked time is reported.
 */
export function setPublicDuration(id: string, milliseconds: number | null) {
  return mutate(function setPublic(entries, user, now) {
    const entry = findOwn(entries, user, id);
    entry.public_duration = milliseconds;
    entry.updated_at = now;
  });
}

export function deleteEntry(id: string) {
  return mutate(function remove(entries, user) {
    const index = entries.findIndex(entry => entry.id === id && entry.user_email === user);
    if (index !== -1) {
      entries.splice(index, 1);
    }
  });
}

/**
 * Every project name the person has used, sorted.
 */
export async function getProjects() {
  const names = new Set<string>();
  const entries = await getEntries();
  for (const entry of entries) {
    if (entry.project) {
      names.add(entry.project);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Segments that start inside the range. A task worked on over several days is split this way,
 * so each day only counts its own work.
 */
export function segmentsInRange(entry: Entry, range: Range) {
  const start = range.start.getTime();
  const end = range.end.getTime();
  return entry.segments.filter(segment => segment.start >= start && segment.start < end);
}

/**
 * Time spent on the task in milliseconds, without pauses. An open segment counts up to now.
 * When a range is given, only segments starting in it count.
 */
export function entryDuration(entry: Entry, range: Range | null, now: number) {
  const segments = range ? segmentsInRange(entry, range) : entry.segments;
  let total = 0;
  for (const segment of segments) {
    total += Math.max(0, (segment.end ?? now) - segment.start);
  }
  return total;
}

/**
 * Time to report for the task in milliseconds: the public time when one is set, otherwise the
 * tracked time. When a range is given and the task ran across several periods, the public time is
 * split between them in the same shares as the tracked time.
 */
export function reportDuration(entry: Entry, range: Range | null, now: number) {
  const tracked = entryDuration(entry, range, now);
  const publicDuration = entry.public_duration;
  if (publicDuration === null) {
    return tracked;
  }
  if (!range) {
    return publicDuration;
  }

  const total = entryDuration(entry, null, now);
  if (total === 0) {
    // With no tracked time there is nothing to split by, so the whole public time goes to the
    // period where the task started.
    const first = entry.segments[0];
    return segmentsInRange(entry, range).includes(first) ? publicDuration : 0;
  }
  return Math.round(publicDuration * tracked / total);
}

/**
 * A backup of the signed-in person's entries, projects, payees, clients, invoices and settings,
 * ready to be saved as JSON.
 */
export async function createBackup() {
  const entries = await getEntries();
  const projects = await getProjects();
  const user = await getKey();
  const invoiceData = await getBackupData();
  const settings = await getSettings();
  return {
    app: 'time-tracker',
    clients: invoiceData.clients,
    entries,
    exported_at: new Date().toISOString(),
    invoices: invoiceData.invoices,
    payees: invoiceData.payees,
    projects,
    settings,
    user,
    version: 4
  };
}

/**
 * The outer shape of a backup file. Version 1 used camelCase keys inside the entries, versions
 * before 3 have no payees, clients or invoices, and versions before 4 have no settings.
 */
interface BackupFile {
  app: 'time-tracker';

  clients?: unknown;

  entries: unknown[];

  invoices?: unknown;

  payees?: unknown;

  settings?: unknown;

  version: number;
}

function isBackupFile(value: any): value is BackupFile {
  return typeof value === 'object'
    && value !== null
    && value.app === 'time-tracker'
    && Array.isArray(value.entries)
    && typeof value.version === 'number';
}

function isStatus(value: any): value is Status {
  return value === 'done' || value === 'paused' || value === 'running';
}

/**
 * Whether the value can be stored as public time. Missing counts, because backups made before
 * public time existed have no such field.
 */
function isPublicDuration(value: any) {
  if (value === undefined || value === null) {
    return true;
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isTime(value: any): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isSegment(value: any): value is Segment {
  return typeof value === 'object'
    && value !== null
    && isTime(value.start)
    && (value.end === null || isTime(value.end));
}

/**
 * Whether the value has the shape of a stored entry, in either version.
 */
function isAnyEntry(value: any): value is Entry | LegacyEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!Array.isArray(value.segments)) {
    return false;
  }
  for (const segment of value.segments) {
    if (!isSegment(segment)) {
      return false;
    }
  }
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.description === 'string'
    && typeof value.project === 'string'
    && isPublicDuration(value.public_duration)
    && isStatus(value.status)
    && (isTime(value.created_at) || isTime(value.createdAt))
    && (isTime(value.updated_at) || isTime(value.updatedAt));
}

/**
 * Whether the segments make sense: there is at least one, they follow each other without
 * overlapping, and only the last one may still be open.
 */
function hasValidSegments(entry: Entry) {
  const segments = entry.segments;
  if (segments.length === 0) {
    return false;
  }
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const next = segments[index + 1];
    if (segment.end === null) {
      if (next) {
        return false;
      }
    } else if (segment.end < segment.start) {
      return false;
    } else if (next && next.start < segment.end) {
      return false;
    }
  }
  return true;
}

/**
 * Merges a backup into the signed-in person's data and returns what happened to the entries.
 *
 * Entries are matched by id. A new one is added, and an existing one is replaced only when the
 * copy in the backup is newer. Entries missing from the backup stay. Everything restored belongs
 * to the person signed in now, so a backup can move entries to another account or computer.
 * Payees, clients, invoices and settings merge the same way.
 */
export async function restoreBackup(backup: unknown) {
  if (!isBackupFile(backup)) {
    throw new Error('Это не файл резервной копии Time Tracker');
  }
  if (backup.version > 4) {
    throw new Error('Копия сделана более новой версией расширения — сначала обновите расширение');
  }

  const counts = await mutate(function merge(entries, user, now) {
    const result = { added: 0, invalid: 0, unchanged: 0, updated: 0 };
    for (const value of backup.entries) {
      mergeOne(entries, user, value, result);
    }
    keepOneRunning(entries, user, now);
    return result;
  });
  await restoreInvoices(backup);
  await restoreSettings(backup.settings);
  return counts;
}

type MergeCounts = { added: number; invalid: number; unchanged: number; updated: number; };

function mergeOne(entries: Entry[], user: string, value: unknown, counts: MergeCounts) {
  if (!isAnyEntry(value)) {
    counts.invalid++;
    return;
  }

  const entry = upgrade(value);
  if (!entry.title.trim()) {
    counts.invalid++;
    return;
  }
  if (!hasValidSegments(entry)) {
    counts.invalid++;
    return;
  }

  // The status has to agree with the last segment, whatever the file says.
  let status = entry.status;
  if (entry.segments.at(-1)?.end === null) {
    status = 'running';
  } else if (status === 'running') {
    status = 'paused';
  }

  const restored: Entry = {
    created_at: entry.created_at,
    description: entry.description,
    id: entry.id,
    project: entry.project.trim(),
    public_duration: entry.public_duration,
    segments: entry.segments.map(segment => ({ end: segment.end, start: segment.start })),
    status,
    title: entry.title.trim(),
    updated_at: entry.updated_at,
    user_email: user
  };

  const index = entries.findIndex(existing => existing.id === restored.id && existing.user_email === user);
  if (index === -1) {
    entries.push(restored);
    counts.added++;
  } else if (restored.updated_at > entries[index].updated_at) {
    entries[index] = restored;
    counts.updated++;
  } else {
    counts.unchanged++;
  }
}

/**
 * After a merge two tasks may both be running. We keep the one started last and pause the rest.
 */
function keepOneRunning(entries: Entry[], user: string, now: number) {
  const running = entries.filter(entry => entry.user_email === user && entry.status === 'running');
  running.sort((a, b) => lastActivityStart(b) - lastActivityStart(a));
  for (const entry of running.slice(1)) {
    closeOpenSegment(entry, now);
    entry.status = 'paused';
    entry.updated_at = now;
  }
}

function lastActivityStart(entry: Entry) {
  const last = entry.segments.at(-1);
  return last ? last.start : entry.created_at;
}


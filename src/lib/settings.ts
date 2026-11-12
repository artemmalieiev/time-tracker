import { getKey } from './user';

// Personal preferences for the pages, one record per person under the "settings" key. Like the
// entries they belong to whoever is signed in to Chrome and travel in backups.

/**
 * Preferences of one person.
 */
interface Settings {
  /**
   * Keys of the journal columns the person chose to hide. We keep the hidden ones rather than
   * the shown ones, so a column added later shows up without anyone turning it on.
   */
  hidden_columns: string[];

  updated_at: number;

  user_email: string;
}

async function readAll() {
  const items = await chrome.storage.local.get('settings');
  return <Settings[] | undefined>items.settings ?? [];
}

/**
 * Preferences of the person signed in to Chrome, or the defaults when they have none yet.
 */
export async function getSettings() {
  const all = await readAll();
  const user = await getKey();
  const found = all.find(settings => settings.user_email === user);
  if (found) {
    return found;
  }
  const defaults: Settings = { hidden_columns: [], updated_at: 0, user_email: user };
  return defaults;
}

// Writes go through a queue so that two quick clicks cannot read the same settings and then
// overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

function mutate(change: (all: Settings[], user: string, now: number) => void) {
  const run = queue.then(async function applyChange() {
    const all = await readAll();
    const user = await getKey();
    change(all, user, Date.now());
    await chrome.storage.local.set({ settings: all });
  });
  queue = run.catch(function keepQueueAlive(error) {
    console.debug('Queued settings write failed', error);
  });
  return run;
}

function put(all: Settings[], settings: Settings) {
  const index = all.findIndex(existing => existing.user_email === settings.user_email);
  if (index === -1) {
    all.push(settings);
  } else {
    all[index] = settings;
  }
}

/**
 * Remembers which journal columns are hidden. Keys missing from the known columns are dropped,
 * so a typo or a removed column never sticks around.
 */
export function setHiddenColumns(columns: string[], known: string[]) {
  const hidden = columns.filter(column => known.includes(column));
  return mutate(function saveHiddenColumns(all, user, now) {
    put(all, { hidden_columns: [...new Set(hidden)], updated_at: now, user_email: user });
  });
}

function isSettings(value: any): value is Settings {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!Array.isArray(value.hidden_columns)) {
    return false;
  }
  for (const column of value.hidden_columns) {
    if (typeof column !== 'string') {
      return false;
    }
  }
  return typeof value.updated_at === 'number' && Number.isFinite(value.updated_at);
}

/**
 * Takes the preferences from a backup for the signed-in person, unless the ones stored here are
 * newer. Backups made before settings existed have none.
 */
export function restore(value: unknown) {
  return mutate(function mergeSettings(all, user) {
    if (!isSettings(value)) {
      return;
    }
    const current = all.find(settings => settings.user_email === user);
    if (current) {
      if (current.updated_at >= value.updated_at) {
        return;
      }
    }
    put(all, { hidden_columns: [...value.hidden_columns], updated_at: value.updated_at, user_email: user });
  });
}

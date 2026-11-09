import console from 'node:console';
import process from 'node:process';

// The extension talks to chrome.storage, chrome.identity and chrome.downloads. Tests run in Node,
// so we put a small in-memory stand-in for those on globalThis. Every test file shares this one
// global, so the files run one after another and each starts from an empty mock.

interface MockState {
  downloads: chrome.downloads.DownloadOptions[];

  /**
   * Email of the pretend Chrome profile. Empty means nobody is signed in.
   */
  email: string;

  /**
   * Download ids erased from Chrome's download history.
   */
  erased: number[];

  /**
   * Download ids whose files were deleted from disk.
   */
  removed: number[];

  /**
   * What the extension saved in chrome.storage.local.
   */
  storage: Map<string, unknown>;
}

export const state: MockState = {
  downloads: [],
  email: 'me@example.com',
  erased: [],
  removed: [],
  storage: new Map()
};

/**
 * Empties the mock, as if the extension was just installed.
 */
export function reset() {
  state.downloads = [];
  state.email = 'me@example.com';
  state.erased = [];
  state.removed = [];
  state.storage = new Map();
}

function toKeys(keys: string | string[]) {
  return Array.isArray(keys) ? keys : [keys];
}

const mock = {
  downloads: {
    download(options: chrome.downloads.DownloadOptions) {
      state.downloads.push(options);
      return Promise.resolve(state.downloads.length);
    },
    erase(query: { id: number; }) {
      state.erased.push(query.id);
      return Promise.resolve([query.id]);
    },
    removeFile(id: number) {
      state.removed.push(id);
      return Promise.resolve();
    }
  },
  identity: {
    AccountStatus: { ANY: 'ANY', SYNC: 'SYNC' },
    getProfileUserInfo() {
      return Promise.resolve({ email: state.email, id: '' });
    }
  },
  storage: {
    local: {
      get(keys: string | string[]) {
        const items: Record<string, unknown> = {};
        for (const key of toKeys(keys)) {
          if (state.storage.has(key)) {
            items[key] = structuredClone(state.storage.get(key));
          }
        }
        return Promise.resolve(items);
      },
      remove(keys: string | string[]) {
        for (const key of toKeys(keys)) {
          state.storage.delete(key);
        }
        return Promise.resolve();
      },
      set(items: Record<string, unknown>) {
        for (const item of Object.entries(items)) {
          state.storage.set(item[0], structuredClone(item[1]));
        }
        return Promise.resolve();
      }
    }
  }
};

Object.defineProperty(globalThis, 'chrome', { configurable: true, value: mock });

let queue = Promise.resolve();

/**
 * Runs a test file's main after the previous test file finished, starting from an empty mock.
 * The first failure stops the whole run with exit code 1.
 */
export function enqueue(name: string, main: () => Promise<void>) {
  queue = queue.then(function runTestFile() {
    reset();
    console.error('Running', name);
    return main();
  });
  queue.catch(function failTests(error) {
    console.error(error);
    process.exit(1);
  });
}

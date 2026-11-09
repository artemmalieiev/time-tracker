import * as autobackup from './lib/autobackup';
import { getPaused, getRunning } from './lib/storage';

// The service worker shows the timer state on the toolbar icon and runs the automatic backup.
// It never counts time itself. Durations come from stored timestamps, so closing Chrome loses
// nothing.

async function updateBadge() {
  const running = await getRunning();
  if (running) {
    // A white dot on red, like a record button. Red is the same signal red as the popup timer.
    await chrome.action.setBadgeBackgroundColor({ color: '#d92b21' });
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    await chrome.action.setBadgeText({ text: '●' });
    return chrome.action.setTitle({ title: `В работе: ${running.title}` });
  }

  const paused = await getPaused();
  if (paused.length > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    await chrome.action.setBadgeText({ text: '❚❚' });
    return chrome.action.setTitle({ title: `На паузе: ${paused.length}` });
  }

  await chrome.action.setBadgeText({ text: '' });
  return chrome.action.setTitle({ title: 'Time Tracker' });
}

async function init() {
  await updateBadge();
  // We check hourly, and the backup itself is written at most once a day.
  return chrome.alarms.create('auto-backup', { delayInMinutes: 1, periodInMinutes: 60 });
}

chrome.runtime.onInstalled.addListener(function onInstalled() {
  init().catch(console.warn);
});

chrome.runtime.onStartup.addListener(function onStartup() {
  init().catch(console.warn);
});

chrome.alarms.onAlarm.addListener(function onAlarm(alarm) {
  if (alarm.name === 'auto-backup') {
    autobackup.run().catch(console.warn);
  }
});

chrome.storage.onChanged.addListener(function onStorageChanged(changes, area) {
  if (area === 'local' && 'entries' in changes) {
    updateBadge().catch(console.warn);
  }
});

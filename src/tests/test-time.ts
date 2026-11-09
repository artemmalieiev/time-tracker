import assert from 'node:assert';
import { formatDate, formatDuration, formatDurationWords, formatRangeLabel, formatTimer, getRange, parseInputDate, parseInputDateTime } from '../lib/time';

function testWeekStartsOnMonday() {
  const range = getRange('week', '', '', new Date(2026, 10, 12, 15));
  assert(range !== null, 'expected a range');
  assert(formatDate(range.start) === '2026-11-09', 'expected the week to start on Monday');
  assert(formatDate(range.end) === '2026-11-16', 'expected the week to end before the next Monday');
}

function testWeekOnSunday() {
  const range = getRange('week', '', '', new Date(2026, 10, 15, 23));
  assert(range !== null, 'expected a range');
  assert(formatDate(range.start) === '2026-11-09', 'expected Sunday to belong to the week that started on Monday');
}

function testLastMonthInJanuary() {
  const range = getRange('lastMonth', '', '', new Date(2026, 0, 10));
  assert(range !== null, 'expected a range');
  assert(formatDate(range.start) === '2025-12-01', 'expected last month to be December of last year');
  assert(formatDate(range.end) === '2026-01-01', 'expected last month to end where January starts');
}

function testCustomRange() {
  const range = getRange('custom', '2026-11-01', '2026-11-03', new Date());
  assert(range !== null, 'expected a range');
  assert(formatDate(range.end) === '2026-11-04', 'expected the last day to be included');
  assert(getRange('custom', '2026-11-05', '2026-11-03', new Date()) === null, 'expected a backwards range to be rejected');
  assert(getRange('custom', '', '2026-11-03', new Date()) === null, 'expected a missing start to be rejected');
}

function testStrictParsing() {
  assert(parseInputDate('2026-02-30') === null, 'expected February 30 to be rejected');
  assert(parseInputDate('junk') === null, 'expected junk to be rejected');
  assert(parseInputDateTime('2026-11-09T25:00') === null, 'expected hour 25 to be rejected');
  const parsed = parseInputDateTime('2026-11-09T08:30');
  assert(parsed !== null && parsed.getHours() === 8 && parsed.getMinutes() === 30, 'expected local time');
}

function testDurations() {
  assert(formatDuration(0) === '0:00', 'expected zero');
  assert(formatDuration(65 * 60000 + 59000) === '1:05', 'expected seconds to be dropped');
  assert(formatTimer(3600000 + 5 * 60000 + 9000) === '1:05:09', 'expected the timer format');
  assert(formatDurationWords(90 * 60000) === '1ч\u00a030мин', 'expected hours and minutes in words');
  assert(formatDurationWords(45 * 60000 + 59000) === '45мин', 'expected minutes only under an hour');
  assert(formatDurationWords(2 * 3600000) === '2ч', 'expected hours only on the hour');
  assert(formatDurationWords(0) === '0мин', 'expected zero minutes');
}

function testRangeLabels() {
  const week = getRange('week', '', '', new Date(2026, 10, 12));
  assert(week !== null && formatRangeLabel(week) === '9–15 ноября 2026', 'expected a range inside one month');
  const across = getRange('custom', '2026-10-28', '2026-11-03', new Date());
  assert(across !== null && formatRangeLabel(across) === '28 октября – 3 ноября 2026', 'expected a range across months');
  const newYear = getRange('custom', '2026-12-30', '2027-01-02', new Date());
  assert(newYear !== null && formatRangeLabel(newYear) === '30 декабря 2026 – 2 января 2027', 'expected a range across years');
  const day = getRange('today', '', '', new Date(2026, 10, 12));
  assert(day !== null && formatRangeLabel(day) === '12 ноября 2026', 'expected a single day');
}

testWeekStartsOnMonday();
testRangeLabels();
testWeekOnSunday();
testLastMonthInJanuary();
testCustomRange();
testStrictParsing();
testDurations();

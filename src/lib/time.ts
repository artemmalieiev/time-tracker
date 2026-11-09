import { addDays, addMonths, format, isValid, parse, startOfDay, startOfMonth, startOfWeek, subMonths } from 'date-fns';

/**
 * A stretch of time, including start and excluding end.
 */
export interface Range {
  end: Date;
  start: Date;
}

export type Period = 'custom' | 'lastMonth' | 'month' | 'today' | 'week';

/**
 * Whether the value is one of the periods the journal can show.
 */
export function isPeriod(value: any): value is Period {
  return value === 'custom'
    || value === 'lastMonth'
    || value === 'month'
    || value === 'today'
    || value === 'week';
}

/**
 * The range for a period in local time, or null when a custom range is missing or backwards.
 * Weeks start on Monday. A custom range includes both of its days.
 *
 * @param from start day of a custom range as "yyyy-MM-dd"
 * @param to last day of a custom range as "yyyy-MM-dd"
 */
export function getRange(period: Period, from: string, to: string, now: Date) {
  const today = startOfDay(now);
  switch (period) {
    case 'today':
      return { end: addDays(today, 1), start: today };
    case 'week': {
      const monday = startOfWeek(today, { weekStartsOn: 1 });
      return { end: addDays(monday, 7), start: monday };
    }
    case 'month': {
      const first = startOfMonth(today);
      return { end: addMonths(first, 1), start: first };
    }
    case 'lastMonth': {
      const first = startOfMonth(today);
      return { end: first, start: subMonths(first, 1) };
    }
    case 'custom': {
      const start = parseInputDate(from);
      if (!start) {
        return null;
      }
      const last = parseInputDate(to);
      if (!last) {
        return null;
      }
      if (last < start) {
        return null;
      }
      return { end: addDays(last, 1), start };
    }
    default: {
      const unreachable: never = period;
      throw new Error('Unknown period', { cause: unreachable });
    }
  }
}

/**
 * Parses the value of an `<input type="date">`, or returns null when it is not a valid date.
 */
export function parseInputDate(value: string) {
  const date = parse(value, 'yyyy-MM-dd', new Date());
  return isValid(date) ? date : null;
}

/**
 * Parses the value of an `<input type="datetime-local">`, or returns null when it is not valid.
 */
export function parseInputDateTime(value: string) {
  const date = parse(value, 'yyyy-MM-dd\'T\'HH:mm', new Date());
  return isValid(date) ? date : null;
}

/**
 * Formats a date for an `<input type="datetime-local">`.
 */
export function formatInputDateTime(date: Date) {
  return format(date, 'yyyy-MM-dd\'T\'HH:mm');
}

/**
 * Formats a date as "yyyy-MM-dd", which is also what an `<input type="date">` expects.
 */
export function formatDate(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

export function formatTime(date: Date) {
  return format(date, 'HH:mm');
}

export function formatDateTime(date: Date) {
  return format(date, 'yyyy-MM-dd HH:mm');
}

/**
 * Formats a duration in milliseconds as hours and minutes.
 *
 * @example "1:05"
 */
export function formatDuration(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}:${rest.toString().padStart(2, '0')}`;
}

/**
 * Formats a duration in milliseconds as hours, minutes and seconds.
 *
 * @example "1:05:09"
 */
export function formatTimer(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const rest = seconds % 60;
  return `${hours}:${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
}

/**
 * Formats a duration in milliseconds as decimal hours.
 *
 * @example "1.08"
 */
export function formatHours(milliseconds: number) {
  return (milliseconds / 3600000).toFixed(2);
}

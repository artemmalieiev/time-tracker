import { addDays, addMonths, format, isSameMonth, isSameYear, isValid, parse, startOfDay, startOfMonth, startOfWeek, subDays, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale/ru';

/**
 * A stretch of time, including start and excluding end.
 */
export interface Range {
  end: Date;
  start: Date;
}

export type Period = 'custom' | 'lastMonth' | 'month' | 'today' | 'week' | 'yesterday';

/**
 * Whether the value is one of the periods the journal can show.
 */
export function isPeriod(value: any): value is Period {
  return value === 'custom'
    || value === 'lastMonth'
    || value === 'month'
    || value === 'today'
    || value === 'week'
    || value === 'yesterday';
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
    case 'yesterday':
      return { end: today, start: subDays(today, 1) };
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

/**
 * The range as people say it, with the last day included.
 *
 * @example "9–15 ноября 2026"
 */
export function formatRangeLabel(range: Range) {
  const first = range.start;
  const last = subDays(range.end, 1);
  if (!isSameYear(first, last)) {
    return `${format(first, 'd MMMM yyyy', { locale: ru })} – ${format(last, 'd MMMM yyyy', { locale: ru })}`;
  }
  if (!isSameMonth(first, last)) {
    return `${format(first, 'd MMMM', { locale: ru })} – ${format(last, 'd MMMM yyyy', { locale: ru })}`;
  }
  if (first.getDate() === last.getDate()) {
    return format(first, 'd MMMM yyyy', { locale: ru });
  }
  return `${format(first, 'd')}–${format(last, 'd MMMM yyyy', { locale: ru })}`;
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
 * Formats a duration in milliseconds as hours and minutes in words, leaving out a zero part.
 * Spaces inside are non-breaking so the value never wraps apart.
 *
 * @example "1ч 30 мин"
 */
export function formatDurationWords(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest}\u00a0мин`;
  }
  if (rest === 0) {
    return `${hours}ч`;
  }
  return `${hours}ч\u00a0${rest}\u00a0мин`;
}

/**
 * Formats a duration in milliseconds as hours and minutes in English words for the CSV export,
 * leaving out a zero part.
 *
 * @example "1h 30 min"
 */
export function formatDurationEnglish(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest} min`;
  }
  if (rest === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${rest} min`;
}

/**
 * Splits a duration in milliseconds into whole hours and the minutes left over, for filling the
 * hours and minutes fields of public time.
 */
export function splitDuration(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60000);
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

function invalidPublicDuration(error: string) {
  return { error, milliseconds: null };
}

/**
 * Reads public time from the text of an hours field and a minutes field. Both empty means no
 * public time, so the tracked time is reported. Returns the problem to show when the fields hold
 * something other than whole numbers or more than 59 minutes.
 */
export function parsePublicDuration(hours: string, minutes: string) {
  const hoursText = hours.trim();
  const minutesText = minutes.trim();
  if (hoursText === '' && minutesText === '') {
    return { error: null, milliseconds: null };
  }
  if (!/^\d*$/.test(hoursText)) {
    return invalidPublicDuration('Часы — целое число не меньше нуля.');
  }
  if (!/^\d*$/.test(minutesText)) {
    return invalidPublicDuration('Минуты — целое число не меньше нуля.');
  }

  const hoursValue = hoursText === '' ? 0 : parseInt(hoursText, 10);
  const minutesValue = minutesText === '' ? 0 : parseInt(minutesText, 10);
  if (minutesValue > 59) {
    return invalidPublicDuration('Минут может быть не больше 59.');
  }
  return { error: null, milliseconds: (hoursValue * 60 + minutesValue) * 60000 };
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

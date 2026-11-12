import { isSameDay, startOfMonth, subDays, subHours, subMinutes } from 'date-fns';
import * as autobackup from './lib/autobackup';
import { byId, el } from './lib/dom';
import { createInvoice } from './lib/invoices';
import { getSettings, setHiddenColumns } from './lib/settings';
import type { Entry, Segment, Status } from './lib/storage';
import {
  addEntry,
  createBackup,
  deleteEntry,
  entryDuration,
  finishTask,
  getEntries,
  getProjects,
  pauseTask,
  reportDuration,
  restoreBackup,
  resumeTask,
  segmentsInRange,
  updateEntry
} from './lib/storage';
import type { Period, Range } from './lib/time';
import {
  formatDate,
  formatDateTime,
  formatDurationEnglish,
  formatDurationWords,
  formatInputDateTime,
  formatRangeLabel,
  formatTime,
  getRange,
  isPeriod,
  parseInputDateTime,
  parsePublicDuration,
  splitDuration
} from './lib/time';
import { toEnglish } from './lib/translate';
import { getEmail } from './lib/user';

// The journal page: entries for a period, totals, editing, CSV export, invoices and backups.

const userLabel = byId('user', HTMLSpanElement);
const autoBackupCheckbox = byId('auto-backup', HTMLInputElement);
const autoBackupInfo = byId('auto-backup-info', HTMLAnchorElement);
const backupButton = byId('btn-backup', HTMLButtonElement);
const restoreButton = byId('btn-restore', HTMLButtonElement);
const restoreInput = byId('restore-file', HTMLInputElement);
const periodsGroup = byId('periods', HTMLDivElement);
const customRange = byId('custom-range', HTMLDivElement);
const fromInput = byId('from', HTMLInputElement);
const toInput = byId('to', HTMLInputElement);
const projectFilter = byId('project-filter', HTMLSelectElement);
const columnsButton = byId('btn-columns', HTMLButtonElement);
const columnsMenu = byId('columns-menu', HTMLDivElement);
const addButton = byId('btn-add', HTMLButtonElement);
const translateCheckbox = byId('translate', HTMLInputElement);
const exportButton = byId('btn-export', HTMLButtonElement);
const invoiceButton = byId('btn-invoice', HTMLButtonElement);
const statusLine = byId('export-status', HTMLParagraphElement);
const totalLabel = byId('total', HTMLDivElement);
const rangeLabel = byId('range-label', HTMLDivElement);
const projectTotals = byId('by-project', HTMLDivElement);
const journalTable = byId('journal', HTMLTableElement);
const rowsBody = byId('rows', HTMLTableSectionElement);
const totalsRow = byId('totals-row', HTMLTableSectionElement);
const totalLabelCell = byId('total-label', HTMLTableCellElement);
const totalDurationCell = byId('total-duration', HTMLTableCellElement);
const totalPublicCell = byId('total-public', HTMLTableCellElement);
const emptyMessage = byId('empty', HTMLParagraphElement);
const editDialog = byId('edit-dialog', HTMLDialogElement);
const editForm = byId('edit-form', HTMLFormElement);
const editHeading = byId('edit-heading', HTMLHeadingElement);
const titleInput = byId('e-title', HTMLInputElement);
const descriptionInput = byId('e-desc', HTMLTextAreaElement);
const projectInput = byId('e-project', HTMLInputElement);
const publicHoursInput = byId('e-public-hours', HTMLInputElement);
const publicMinutesInput = byId('e-public-minutes', HTMLInputElement);
const projectOptions = byId('projects', HTMLDataListElement);
const addSegmentButton = byId('add-segment', HTMLButtonElement);
const segmentsContainer = byId('segments', HTMLDivElement);
const editError = byId('edit-error', HTMLParagraphElement);
const editCancelButton = byId('edit-cancel', HTMLButtonElement);

/**
 * What the journal shows. Remembered per browser between visits.
 */
interface Filters {
  /**
   * First day of a custom range, as "yyyy-MM-dd".
   */
  from: string;

  period: Period;

  /**
   * A project name, an empty string for all projects, or "__none__" for entries without one.
   */
  project: string;

  /**
   * Last day of a custom range, as "yyyy-MM-dd".
   */
  to: string;
}

function isFilters(value: any): value is Filters {
  return typeof value === 'object'
    && value !== null
    && typeof value.from === 'string'
    && isPeriod(value.period)
    && typeof value.project === 'string'
    && typeof value.to === 'string';
}

function loadFilters() {
  const today = new Date();
  const defaults: Filters = {
    from: formatDate(startOfMonth(today)),
    period: 'week',
    project: '',
    to: formatDate(today)
  };

  let saved: unknown = null;
  try {
    saved = JSON.parse(localStorage.getItem('filters') ?? 'null');
  } catch (error) {
    console.debug('Saved filters are unreadable', error);
  }
  return isFilters(saved) ? saved : defaults;
}

function saveFilters() {
  try {
    localStorage.setItem('filters', JSON.stringify(filters));
  } catch (error) {
    console.debug('Could not remember filters', error);
  }
}

const filters = loadFilters();
let currentRange: Range | null = null;
let rows: Entry[] = [];
let hiddenColumns: string[] = [];
const durationCells = new Map<string, HTMLTableCellElement>();
const publicCells = new Map<string, HTMLTableCellElement>();

function statusLabel(status: Status) {
  switch (status) {
    case 'running':
      return 'В работе';
    case 'paused':
      return 'На паузе';
    case 'done':
      return 'Завершена';
    default: {
      const unreachable: never = status;
      throw new Error('Unknown status', { cause: unreachable });
    }
  }
}

function statusLabelEnglish(status: Status) {
  switch (status) {
    case 'running':
      return 'In progress';
    case 'paused':
      return 'Paused';
    case 'done':
      return 'Done';
    default: {
      const unreachable: never = status;
      throw new Error('Unknown status', { cause: unreachable });
    }
  }
}

function setStatus(message: string) {
  statusLine.textContent = message;
}

function matchesProject(entry: Entry) {
  if (filters.project === '') {
    return true;
  }
  if (filters.project === '__none__') {
    return entry.project === '';
  }
  return entry.project === filters.project;
}

function firstStart(entry: Entry, range: Range) {
  return segmentsInRange(entry, range)[0].start;
}

function renderProjectOptions(projects: string[]) {
  const names = [...projects];
  if (filters.project !== '' && filters.project !== '__none__' && !names.includes(filters.project)) {
    names.push(filters.project);
  }
  projectFilter.replaceChildren(
    el('option', { text: 'Все проекты', value: '' }, []),
    ...names.map(name => el('option', { text: name, value: name }, [])),
    el('option', { text: 'Без проекта', value: '__none__' }, [])
  );
  projectFilter.value = filters.project;
  projectOptions.replaceChildren(...projects.map(name => el('option', { value: name }, [])));
}

function actionButton(action: string, label: string, className: string) {
  return el('button', { className, dataset: { action }, text: label }, []);
}

function renderActions(entry: Entry) {
  const buttons: HTMLButtonElement[] = [];
  if (entry.status === 'running') {
    buttons.push(actionButton('pause', 'Пауза', 'small'));
  } else {
    buttons.push(actionButton('resume', 'Продолжить', 'small'));
  }
  if (entry.status === 'paused') {
    buttons.push(actionButton('finish', 'Завершить', 'small quiet'));
  }
  buttons.push(actionButton('edit', 'Изменить', 'small quiet'), actionButton('delete', 'Удалить', 'small quiet danger'));
  return buttons;
}

/**
 * Title with the description under it, so a long description wraps under the task instead of
 * squeezing a column of its own.
 */
function renderTask(entry: Entry) {
  const parts = [el('div', { className: 'task-title', text: entry.title }, [])];
  if (entry.description) {
    parts.push(el('div', { className: 'task-description', text: entry.description }, []));
  }
  return parts;
}

/**
 * When the task starts and ends inside the range. The end is null while the task runs.
 */
function rowSpan(entry: Entry, range: Range) {
  const segments = segmentsInRange(entry, range);
  const lastEnd = segments[segments.length - 1].end;
  return {
    end: lastEnd === null ? null : new Date(lastEnd),
    start: new Date(segments[0].start)
  };
}

/**
 * The end as the journal prints it: the time alone on the start day, the date too on a later one.
 */
function formatEnd(start: Date, end: Date | null, running: string) {
  if (end === null) {
    return running;
  }
  return isSameDay(start, end) ? formatTime(end) : formatDateTime(end);
}

function renderRow(entry: Entry, range: Range) {
  const span = rowSpan(entry, range);
  const start = span.start;
  const end = formatEnd(start, span.end, 'идёт');

  const durationCell = el('td', { className: 'num dur', dataset: { col: 'duration' } }, []);
  durationCells.set(entry.id, durationCell);

  // Without public time the tracked time goes to the report, so we show it dimmed to say so.
  const publicCell = el('td', { className: 'num', dataset: { col: 'public' } }, []);
  if (entry.public_duration === null) {
    publicCell.classList.add('muted');
    publicCell.title = 'Не задано, в инвойс и CSV пойдёт фактическое время';
  }
  publicCells.set(entry.id, publicCell);

  return el('tr', { dataset: { id: entry.id } }, [
    el('td', { className: 'nowrap', dataset: { col: 'date' }, text: formatDate(start) }, []),
    el('td', { className: 'project', dataset: { col: 'project' }, text: entry.project || '—' }, []),
    el('td', { className: 'task', dataset: { col: 'task' } }, renderTask(entry)),
    el('td', { dataset: { col: 'status' } }, [el('span', { className: `status ${entry.status}`, text: statusLabel(entry.status) }, [])]),
    el('td', { className: 'nowrap', dataset: { col: 'start' }, text: formatTime(start) }, []),
    el('td', { className: 'nowrap', dataset: { col: 'end' }, text: end }, []),
    durationCell,
    publicCell,
    el('td', { className: 'actions' }, renderActions(entry))
  ]);
}

/**
 * Durations of a running task change every minute, so they are refreshed apart from the table.
 */
function renderDurations() {
  const now = Date.now();
  let total = 0;
  let publicTotal = 0;
  const totals = new Map<string, number>();
  for (const entry of rows) {
    const reported = reportDuration(entry, currentRange, now);
    publicTotal += reported;
    const publicCell = publicCells.get(entry.id);
    if (publicCell) {
      publicCell.textContent = formatDurationWords(reported);
    }

    const duration = entryDuration(entry, currentRange, now);
    total += duration;
    const name = entry.project || 'Без проекта';
    totals.set(name, (totals.get(name) ?? 0) + duration);
    const cell = durationCells.get(entry.id);
    if (cell) {
      cell.textContent = formatDurationWords(duration);
    }
  }

  totalLabel.textContent = formatDurationWords(total);
  totalDurationCell.textContent = formatDurationWords(total);
  totalPublicCell.textContent = formatDurationWords(publicTotal);
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    projectTotals.replaceChildren(el('p', { className: 'muted', text: 'Пока пусто' }, []));
    return;
  }
  const longest = sorted[0][1];
  projectTotals.replaceChildren(...sorted.map(item => renderRankedRow(item[0], item[1], longest, total)));
}

/**
 * One project in the ranked bars. Bars share one baseline and scale to the longest project, so
 * their lengths compare directly. The share of the period is printed beside each one.
 */
function renderRankedRow(name: string, duration: number, longest: number, total: number) {
  const share = total > 0 ? Math.round(duration / total * 100) : 0;
  const bar = el('div', { className: 'ranked-bar' }, []);
  bar.style.width = `${longest > 0 ? duration / longest * 100 : 0}%`;
  return el('div', { className: 'ranked-row', title: `${name}: ${formatDurationWords(duration)}, ${share}%` }, [
    el('span', { className: 'ranked-name', text: name }, []),
    el('div', { className: 'ranked-track' }, [bar]),
    el('span', { className: 'ranked-value', text: formatDurationWords(duration) }, []),
    el('span', { className: 'ranked-share', text: `${share}%` }, [])
  ]);
}

async function render() {
  const entries = await getEntries();
  const projects = await getProjects();
  renderProjectOptions(projects);

  const range = getRange(filters.period, filters.from, filters.to, new Date());
  currentRange = range;
  rows = [];
  durationCells.clear();
  publicCells.clear();

  if (range) {
    for (const entry of entries) {
      if (!matchesProject(entry)) {
        continue;
      }
      if (segmentsInRange(entry, range).length === 0) {
        continue;
      }
      rows.push(entry);
    }
    rows.sort((a, b) => firstStart(b, range) - firstStart(a, range));
    rangeLabel.textContent = formatRangeLabel(range);
    rowsBody.replaceChildren(...rows.map(entry => renderRow(entry, range)));
  } else {
    rangeLabel.textContent = 'Выберите даты: начало не позже конца';
    rowsBody.replaceChildren();
  }

  emptyMessage.hidden = rows.length > 0;
  totalsRow.hidden = rows.length === 0;
  renderDurations();
}

/**
 * Columns a person may hide, taken from the table header. The row actions have no data-col and
 * always stay, so every row can still be edited.
 */
function hideableColumns() {
  const columns: { key: string; label: string; }[] = [];
  for (const header of journalTable.querySelectorAll<HTMLTableCellElement>('thead th')) {
    const key = header.dataset.col;
    if (key === undefined) {
      continue;
    }
    columns.push({ key, label: header.textContent ?? key });
  }
  return columns;
}

function renderColumnsMenu() {
  const items: HTMLLabelElement[] = [];
  for (const column of hideableColumns()) {
    const checkbox = el('input', { type: 'checkbox', value: column.key }, []);
    items.push(el('label', { className: 'check' }, [checkbox, column.label]));
  }
  columnsMenu.replaceChildren(...items);
}

/**
 * Shows and hides the table columns. The stylesheet does the hiding, so the rows need no redraw.
 */
function applyColumns(hidden: string[]) {
  hiddenColumns = hidden;
  journalTable.dataset.hidden = hidden.join(' ');
  for (const checkbox of columnsMenu.querySelectorAll('input')) {
    checkbox.checked = !hidden.includes(checkbox.value);
  }

  // «Итого» spans every column before the durations, so it has to shrink when some of them hide.
  let span = 0;
  for (const header of journalTable.querySelectorAll<HTMLTableCellElement>('thead th')) {
    const key = header.dataset.col;
    if (key === 'duration') {
      break;
    }
    if (key === undefined || !hidden.includes(key)) {
      span++;
    }
  }
  // With every one of them hidden there is no room left for the label, so it hides too.
  totalLabelCell.hidden = span === 0;
  totalLabelCell.colSpan = Math.max(span, 1);
}

async function renderColumns() {
  const settings = await getSettings();
  applyColumns(settings.hidden_columns);
}

function saveColumns() {
  const hidden: string[] = [];
  const known: string[] = [];
  for (const checkbox of columnsMenu.querySelectorAll('input')) {
    known.push(checkbox.value);
    if (!checkbox.checked) {
      hidden.push(checkbox.value);
    }
  }
  applyColumns(hidden);
  return setHiddenColumns(hidden, known);
}

function syncPeriodControls() {
  for (const input of periodsGroup.querySelectorAll('input')) {
    input.checked = input.value === filters.period;
  }
  customRange.hidden = filters.period !== 'custom';
  fromInput.value = filters.from;
  toInput.value = filters.to;
}

function runRowAction(action: string | undefined, entry: Entry) {
  switch (action) {
    case 'pause':
      pauseTask(entry.id).catch(console.warn);
      break;
    case 'resume':
      resumeTask(entry.id).catch(console.warn);
      break;
    case 'finish':
      finishTask(entry.id).catch(console.warn);
      break;
    case 'edit':
      openEditor(entry);
      break;
    case 'delete':
      if (confirm(`Удалить «${entry.title}»?`)) {
        deleteEntry(entry.id).catch(console.warn);
      }
      break;
    default:
      console.warn('Unknown row action', action);
  }
}

// Edit dialog

/**
 * The inputs of one segment in the edit dialog.
 */
interface SegmentRow {
  end: HTMLInputElement;

  row: HTMLDivElement;

  start: HTMLInputElement;
}

let editing: Entry | null = null;
let segmentRows: SegmentRow[] = [];

function timeInput(time: number | null, label: string) {
  const input = el('input', { type: 'datetime-local', value: time === null ? '' : formatInputDateTime(new Date(time)) }, []);
  input.setAttribute('aria-label', label);
  // The input only shows minutes. We keep the exact time so a field the person did not touch
  // keeps its seconds.
  input.dataset.original = input.value;
  input.dataset.exact = time === null ? '' : time.toString();
  return input;
}

function readTime(input: HTMLInputElement) {
  const exact = input.dataset.exact;
  if (exact && input.value === input.dataset.original) {
    return parseInt(exact, 10);
  }
  const date = parseInputDateTime(input.value);
  return date ? date.getTime() : null;
}

function addSegmentRow(segment: Segment) {
  const start = timeInput(segment.start, 'Начало');
  const end = timeInput(segment.end, 'Конец');
  const removeButton = el('button', { className: 'small danger', text: '✕', title: 'Удалить интервал', type: 'button' }, []);
  const row = el('div', { className: 'segment' }, [start, el('span', { className: 'muted', text: '—' }, []), end, removeButton]);
  const item: SegmentRow = { end, row, start };

  removeButton.addEventListener('click', function onRemoveSegmentClick() {
    row.remove();
    segmentRows = segmentRows.filter(other => other !== item);
  });

  segmentRows.push(item);
  segmentsContainer.append(row);
}

function openEditor(entry: Entry | null) {
  editing = entry;
  segmentRows = [];
  segmentsContainer.replaceChildren();

  if (entry) {
    editHeading.textContent = 'Изменить запись';
    titleInput.value = entry.title;
    descriptionInput.value = entry.description;
    projectInput.value = entry.project;
    fillPublicFields(entry);
    for (const segment of entry.segments) {
      addSegmentRow(segment);
    }
  } else {
    const now = new Date();
    editHeading.textContent = 'Новая запись';
    titleInput.value = '';
    descriptionInput.value = '';
    projectInput.value = filters.project === '__none__' ? '' : filters.project;
    fillPublicFields(null);
    addSegmentRow({ end: now.getTime(), start: subHours(now, 1).getTime() });
  }

  editError.textContent = '';
  editDialog.showModal();
  titleInput.focus();
}

/**
 * Fills the public time fields. Empty fields show the tracked time as a placeholder, so the person
 * sees what gets reported when they leave them empty.
 */
function fillPublicFields(entry: Entry | null) {
  const tracked = splitDuration(entry ? entryDuration(entry, null, Date.now()) : 0);
  publicHoursInput.placeholder = tracked.hours.toString();
  publicMinutesInput.placeholder = tracked.minutes.toString();
  if (entry && entry.public_duration !== null) {
    const parts = splitDuration(entry.public_duration);
    publicHoursInput.value = parts.hours.toString();
    publicMinutesInput.value = parts.minutes.toString();
  } else {
    publicHoursInput.value = '';
    publicMinutesInput.value = '';
  }
}

function invalid(error: string) {
  return { draft: null, error };
}

/**
 * Reads the edit dialog and checks it. Returns the entry fields, or the problem to show.
 */
function validate() {
  const title = titleInput.value.trim();
  if (!title) {
    return invalid('Укажите название.');
  }
  if (segmentRows.length === 0) {
    return invalid('Нужен хотя бы один интервал.');
  }

  const segments: Segment[] = [];
  for (const item of segmentRows) {
    const start = readTime(item.start);
    if (start === null) {
      return invalid('Укажите начало у каждого интервала.');
    }
    const end = readTime(item.end);
    if (end !== null && end <= start) {
      return invalid('Конец интервала должен быть позже начала.');
    }
    segments.push({ end, start });
  }
  segments.sort((a, b) => a.start - b.start);

  const openIndex = segments.findIndex(segment => segment.end === null);
  if (openIndex !== -1) {
    if (openIndex !== segments.length - 1) {
      return invalid('Пустой конец допустим только у последнего интервала.');
    }
    if (segments[openIndex].start > Date.now()) {
      return invalid('Начало текущего интервала не может быть в будущем.');
    }
  }
  for (let index = 0; index < segments.length - 1; index++) {
    const end = segments[index].end;
    if (end !== null && end > segments[index + 1].start) {
      return invalid('Интервалы пересекаются.');
    }
  }

  // An empty end on the last segment means the task is being worked on right now.
  let status: Status;
  if (openIndex !== -1) {
    status = 'running';
  } else if (!editing) {
    status = 'done';
  } else if (editing.status === 'running') {
    status = 'paused';
  } else {
    status = editing.status;
  }

  const publicDuration = parsePublicDuration(publicHoursInput.value, publicMinutesInput.value);
  if (publicDuration.error !== null) {
    return invalid(publicDuration.error);
  }

  const draft = {
    description: descriptionInput.value,
    project: projectInput.value,
    public_duration: publicDuration.milliseconds,
    segments,
    status,
    title
  };
  return { draft, error: null };
}

async function saveEditor() {
  const result = validate();
  if (result.draft === null) {
    editError.textContent = result.error;
    return;
  }

  if (editing) {
    await updateEntry(editing.id, result.draft);
  } else {
    await addEntry(result.draft);
  }
  editDialog.close();
}

function showEditError(error: unknown) {
  editError.textContent = error instanceof Error ? error.message : 'Не удалось сохранить';
}

// CSV export

function escapeCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildCsv(lines: string[][]) {
  // The byte order mark makes Excel read the file as UTF-8.
  return '﻿' + lines.map(line => line.map(escapeCell).join(',')).join('\r\n');
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = el('a', {}, []);
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(function revokeDownloadUrl() {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Keys of the columns shown in the journal now, in table order. The CSV takes the same ones.
 */
function shownColumns() {
  const columns: string[] = [];
  for (const column of hideableColumns()) {
    if (!hiddenColumns.includes(column.key)) {
      columns.push(column.key);
    }
  }
  return columns;
}

function csvHeader(columns: string[]) {
  const header: string[] = [];
  for (const column of columns) {
    switch (column) {
      case 'date':
        header.push('Date');
        break;
      case 'project':
        header.push('Project');
        break;
      case 'task':
        header.push('Title', 'Description');
        break;
      case 'status':
        header.push('Status');
        break;
      case 'start':
        header.push('Start');
        break;
      case 'end':
        header.push('End');
        break;
      case 'duration':
        header.push('Tracked');
        break;
      case 'public':
        header.push('Duration');
        break;
      default:
        throw new Error('Unknown journal column', { cause: column });
    }
  }
  return header;
}

function csvRow(entry: Entry, range: Range, columns: string[], translations: Map<string, string>, now: number) {
  const span = rowSpan(entry, range);
  const row: string[] = [];
  for (const column of columns) {
    switch (column) {
      case 'date':
        row.push(formatDate(span.start));
        break;
      case 'project':
        row.push(translations.get(entry.project) ?? entry.project);
        break;
      case 'task':
        row.push(translations.get(entry.title) ?? entry.title, translations.get(entry.description) ?? entry.description);
        break;
      case 'status':
        row.push(statusLabelEnglish(entry.status));
        break;
      case 'start':
        row.push(formatTime(span.start));
        break;
      case 'end':
        row.push(formatEnd(span.start, span.end, 'in progress'));
        break;
      case 'duration':
        row.push(formatDurationEnglish(entryDuration(entry, range, now)));
        break;
      case 'public':
        row.push(formatDurationEnglish(reportDuration(entry, range, now)));
        break;
      default:
        throw new Error('Unknown journal column', { cause: column });
    }
  }
  return row;
}

/**
 * The last line: the word Total in the first cell and the sums under the time columns.
 */
function csvTotal(columns: string[], tracked: number, reported: number) {
  const row: string[] = [];
  for (const column of columns) {
    if (column === 'duration') {
      row.push(formatDurationEnglish(tracked));
    } else if (column === 'public') {
      row.push(formatDurationEnglish(reported));
    } else if (column === 'task') {
      row.push('', '');
    } else {
      row.push('');
    }
  }
  // When the table starts with a time column, its sum keeps the first cell.
  if (row[0] === '') {
    row[0] = 'Total';
  }
  return row;
}

/**
 * Translates the texts when «На английском» is on. Returns the translations and a note for the
 * status line about anything left untranslated.
 */
async function translateIfAsked(texts: string[]) {
  const translations = new Map<string, string>();
  if (!translateCheckbox.checked) {
    return { note: '', translations };
  }
  const result = await toEnglish(texts, setStatus);
  if (result === null) {
    return { note: ' Перевод недоступен в этой версии Chrome (нужен Chrome 138+ на компьютере) — текст оставлен как есть.', translations };
  }
  if (result.failedLanguages.length > 0) {
    return { note: ` Не удалось перевести с языков: ${result.failedLanguages.join(', ')} — эти тексты оставлены как есть.`, translations: result.translations };
  }
  return { note: '', translations: result.translations };
}

async function exportCsv() {
  const range = currentRange;
  if (!range) {
    setStatus('Выберите корректный диапазон дат.');
    return;
  }
  if (rows.length === 0) {
    setStatus('Нет записей для экспорта за выбранный период.');
    return;
  }
  const columns = shownColumns();
  if (columns.length === 0) {
    setStatus('Все колонки скрыты — включите хоть одну в «Колонках».');
    return;
  }

  // Only the texts that go into the file need translating.
  const texts: string[] = [];
  for (const entry of rows) {
    if (columns.includes('task')) {
      texts.push(entry.title, entry.description);
    }
    if (columns.includes('project')) {
      texts.push(entry.project);
    }
  }
  const translated = await translateIfAsked(texts);

  const now = Date.now();
  const exported = [...rows].sort((a, b) => firstStart(a, range) - firstStart(b, range));
  const lines = [csvHeader(columns)];
  let tracked = 0;
  let reported = 0;
  for (const entry of exported) {
    lines.push(csvRow(entry, range, columns, translated.translations, now));
    tracked += entryDuration(entry, range, now);
    reported += reportDuration(entry, range, now);
  }
  lines.push(csvTotal(columns, tracked, reported));

  downloadFile(
    `time-tracker_${formatDate(range.start)}_${formatDate(subDays(range.end, 1))}.csv`,
    buildCsv(lines),
    'text/csv;charset=utf-8'
  );
  setStatus(`CSV скачан, записей: ${exported.length}.${translated.note}`);
}

async function runExport() {
  exportButton.disabled = true;
  try {
    await exportCsv();
  } finally {
    exportButton.disabled = false;
  }
}

function showExportError(error: unknown) {
  console.warn(error);
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    setStatus('Chrome не разрешил скачать модель перевода — нажмите кнопку ещё раз.');
    return;
  }
  setStatus(`Ошибка: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
}

// Invoices

/**
 * Makes an invoice from the tasks the journal shows now, one line per task with the time the CSV
 * would report, and opens it. The tasks themselves stay as they are.
 */
async function makeInvoice() {
  const range = currentRange;
  if (!range) {
    setStatus('Выберите корректный диапазон дат.');
    return;
  }
  if (rows.length === 0) {
    setStatus('Нет записей для инвойса за выбранный период.');
    return;
  }

  const texts: string[] = [];
  for (const entry of rows) {
    texts.push(entry.title);
  }
  const translated = await translateIfAsked(texts);

  const now = Date.now();
  const billed = [...rows].sort((a, b) => firstStart(a, range) - firstStart(b, range));
  const tasks: Parameters<typeof createInvoice>[0] = [];
  for (const entry of billed) {
    tasks.push({
      duration: reportDuration(entry, range, now),
      entry_id: entry.id,
      title: translated.translations.get(entry.title) ?? entry.title
    });
  }
  const period = { from: formatDate(range.start), to: formatDate(subDays(range.end, 1)) };
  const invoice = await createInvoice(tasks, period, new Date());

  let note = translated.note;
  for (const entry of billed) {
    if (entry.status === 'running') {
      note += ` Задача «${entry.title}» ещё идёт — в инвойс попало время на сейчас.`;
    }
  }
  setStatus(`Инвойс № ${invoice.number} создан.${note}`);
  await chrome.tabs.create({ url: chrome.runtime.getURL(`invoices.html#edit=${invoice.id}`) });
}

async function runMakeInvoice() {
  invoiceButton.disabled = true;
  try {
    await makeInvoice();
  } finally {
    invoiceButton.disabled = false;
  }
}

// Backups

async function saveBackup() {
  const backup = await createBackup();
  downloadFile(`time-tracker-backup_${formatDate(new Date())}.json`, JSON.stringify(backup, null, 2), 'application/json');
  setStatus(`Копия сохранена, записей: ${backup.entries.length}.`);
}

function parseJson(text: string) {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch (error) {
    // Not JSON at all. Restoring null fails with a message the person understands.
    console.debug('Backup file is not JSON', error);
    return null;
  }
}

async function restoreFromFile(file: File) {
  const text = await file.text();
  const message = `Восстановить записи из «${file.name}»?\n\n`
    + 'Новые записи будут добавлены, совпадающие — обновлены, если в копии они новее. '
    + 'Текущие записи, которых нет в копии, останутся.';
  if (!confirm(message)) {
    return;
  }

  const result = await restoreBackup(parseJson(text));
  const parts = [`добавлено — ${result.added}`, `обновлено — ${result.updated}`, `без изменений — ${result.unchanged}`];
  if (result.invalid > 0) {
    parts.push(`пропущено повреждённых — ${result.invalid}`);
  }
  setStatus(`Восстановление завершено: ${parts.join(', ')}.`);
}

function showBackupError(error: unknown) {
  console.warn(error);
  setStatus(`Не удалось: ${error instanceof Error ? error.message : 'неизвестная ошибка'}.`);
}

let lastBackupId: number | null = null;

async function renderAutoBackup() {
  const meta = await autobackup.getMeta();
  lastBackupId = meta.last_id;
  autoBackupCheckbox.checked = meta.enabled;
  autoBackupInfo.classList.toggle('error', meta.enabled && meta.last_error !== null);

  if (!meta.enabled) {
    autoBackupInfo.textContent = 'выключена';
    autoBackupInfo.title = '';
  } else if (meta.last_error !== null) {
    autoBackupInfo.textContent = 'ошибка автокопии';
    autoBackupInfo.title = meta.last_error;
  } else if (meta.last_at !== null) {
    autoBackupInfo.textContent = `последняя: ${formatDateTime(new Date(meta.last_at))}`;
    autoBackupInfo.title = 'Папка «Загрузки/time-tracker-backups», хранятся последние 14. Нажмите, чтобы показать файл.';
  } else {
    autoBackupInfo.textContent = 'ещё не создавалась';
    autoBackupInfo.title = 'Первая копия появится в течение часа после появления записей.';
  }
}

async function showLastBackup() {
  if (lastBackupId !== null) {
    const found = await chrome.downloads.search({ id: lastBackupId });
    if (found.length > 0 && found[0].exists) {
      chrome.downloads.show(lastBackupId);
      return;
    }
  }
  chrome.downloads.showDefaultFolder();
}

async function renderUser() {
  const email = await getEmail();
  userLabel.textContent = email ? `Аккаунт: ${email}` : 'Не выполнен вход в Chrome — записи хранятся локально';
}

// Listeners

periodsGroup.addEventListener('change', function onPeriodChange(event) {
  const target = event.target;
  if (target instanceof HTMLInputElement && isPeriod(target.value)) {
    filters.period = target.value;
    saveFilters();
    syncPeriodControls();
    render().catch(console.warn);
  }
});

fromInput.addEventListener('change', function onFromChange() {
  filters.from = fromInput.value;
  saveFilters();
  render().catch(console.warn);
});

toInput.addEventListener('change', function onToChange() {
  filters.to = toInput.value;
  saveFilters();
  render().catch(console.warn);
});

projectFilter.addEventListener('change', function onProjectFilterChange() {
  filters.project = projectFilter.value;
  saveFilters();
  render().catch(console.warn);
});

columnsMenu.addEventListener('change', function onColumnsChange() {
  saveColumns().catch(console.warn);
});

// The menu sits in the top layer, away from its button, so we place it under the button each time
// it opens, lined up with the button's left edge.
columnsMenu.addEventListener('beforetoggle', function onColumnsMenuToggle(event) {
  if (event.newState === 'open') {
    const rect = columnsButton.getBoundingClientRect();
    columnsMenu.style.top = `${rect.bottom + 4}px`;
    columnsMenu.style.left = `${rect.left}px`;
  }
});

addButton.addEventListener('click', function onAddClick() {
  openEditor(null);
});

rowsBody.addEventListener('click', function onRowsClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const id = target.closest('tr')?.dataset.id;
  const entry = rows.find(item => item.id === id);
  if (entry) {
    runRowAction(target.dataset.action, entry);
  }
});

addSegmentButton.addEventListener('click', function onAddSegmentClick() {
  const now = new Date();
  addSegmentRow({ end: now.getTime(), start: subMinutes(now, 30).getTime() });
});

editCancelButton.addEventListener('click', function onEditCancelClick() {
  editDialog.close();
});

editForm.addEventListener('submit', function onEditSubmit(event) {
  event.preventDefault();
  saveEditor().catch(showEditError);
});

exportButton.addEventListener('click', function onExportClick() {
  runExport().catch(showExportError);
});

invoiceButton.addEventListener('click', function onInvoiceClick() {
  runMakeInvoice().catch(showExportError);
});

backupButton.addEventListener('click', function onBackupClick() {
  saveBackup().catch(showBackupError);
});

restoreButton.addEventListener('click', function onRestoreClick() {
  restoreInput.click();
});

restoreInput.addEventListener('change', function onRestoreFileChosen() {
  const file = restoreInput.files?.[0];
  // Clearing the input lets the person choose the same file again later.
  restoreInput.value = '';
  if (file) {
    restoreFromFile(file).catch(showBackupError);
  }
});

autoBackupCheckbox.addEventListener('change', function onAutoBackupToggle() {
  autobackup.setEnabled(autoBackupCheckbox.checked).catch(console.warn);
});

autoBackupInfo.addEventListener('click', function onAutoBackupInfoClick(event) {
  event.preventDefault();
  showLastBackup().catch(console.warn);
});

chrome.storage.onChanged.addListener(function onStorageChanged(changes, area) {
  if (area !== 'local') {
    return;
  }
  if ('entries' in changes) {
    render().catch(console.warn);
  }
  if ('auto_backup' in changes) {
    renderAutoBackup().catch(console.warn);
  }
  if ('settings' in changes) {
    renderColumns().catch(console.warn);
  }
});

setInterval(function refreshRunningDurations() {
  if (rows.some(entry => entry.status === 'running')) {
    renderDurations();
  }
}, 15000);

async function init() {
  syncPeriodControls();
  renderColumnsMenu();
  await renderColumns();
  await render();
  if (location.hash === '#new') {
    history.replaceState(null, '', location.pathname);
    openEditor(null);
  }
}

init().catch(console.warn);
renderUser().catch(console.warn);
renderAutoBackup().catch(console.warn);

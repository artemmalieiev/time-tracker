import { isSameDay, startOfMonth, subDays, subHours, subMinutes } from 'date-fns';
import * as autobackup from './lib/autobackup';
import { byId, el } from './lib/dom';
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
  restoreBackup,
  resumeTask,
  segmentsInRange,
  updateEntry
} from './lib/storage';
import type { Period, Range } from './lib/time';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatHours,
  formatInputDateTime,
  formatTime,
  getRange,
  isPeriod,
  parseInputDateTime
} from './lib/time';
import { getEmail } from './lib/user';

// The journal page: entries for a period, totals, editing, CSV export and backups.

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
const addButton = byId('btn-add', HTMLButtonElement);
const translateCheckbox = byId('translate', HTMLInputElement);
const exportButton = byId('btn-export', HTMLButtonElement);
const statusLine = byId('export-status', HTMLParagraphElement);
const totalLabel = byId('total', HTMLDivElement);
const rangeLabel = byId('range-label', HTMLDivElement);
const projectTotals = byId('by-project', HTMLDivElement);
const rowsBody = byId('rows', HTMLTableSectionElement);
const totalsRow = byId('totals-row', HTMLTableSectionElement);
const totalDurationCell = byId('total-duration', HTMLTableCellElement);
const totalSessionsCell = byId('total-sessions', HTMLTableCellElement);
const emptyMessage = byId('empty', HTMLParagraphElement);
const editDialog = byId('edit-dialog', HTMLDialogElement);
const editForm = byId('edit-form', HTMLFormElement);
const editHeading = byId('edit-heading', HTMLHeadingElement);
const titleInput = byId('e-title', HTMLInputElement);
const descriptionInput = byId('e-desc', HTMLTextAreaElement);
const projectInput = byId('e-project', HTMLInputElement);
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
const durationCells = new Map<string, HTMLTableCellElement>();

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

/**
 * Number of work segments in the range across all the entries.
 */
function countSessions(entries: Entry[], range: Range) {
  let count = 0;
  for (const entry of entries) {
    count += segmentsInRange(entry, range).length;
  }
  return count;
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

function actionButton(action: string, label: string) {
  const className = action === 'delete' ? 'small danger' : 'small';
  return el('button', { className, dataset: { action }, text: label }, []);
}

function renderActions(entry: Entry) {
  const buttons: HTMLButtonElement[] = [];
  if (entry.status === 'running') {
    buttons.push(actionButton('pause', 'Пауза'));
  } else {
    buttons.push(actionButton('resume', 'Продолжить'));
  }
  if (entry.status === 'paused') {
    buttons.push(actionButton('finish', 'Завершить'));
  }
  buttons.push(actionButton('edit', 'Изменить'), actionButton('delete', 'Удалить'));
  return buttons;
}

function renderRow(entry: Entry, range: Range) {
  const segments = segmentsInRange(entry, range);
  const start = new Date(segments[0].start);
  const lastEnd = segments[segments.length - 1].end;
  let end = 'идёт';
  if (lastEnd !== null) {
    const endDate = new Date(lastEnd);
    end = isSameDay(start, endDate) ? formatTime(endDate) : formatDateTime(endDate);
  }

  const durationCell = el('td', { className: 'num dur' }, []);
  durationCells.set(entry.id, durationCell);

  return el('tr', { dataset: { id: entry.id } }, [
    el('td', { className: 'nowrap', text: formatDate(start) }, []),
    el('td', { text: entry.project || '—' }, []),
    el('td', { className: 'title-cell', text: entry.title }, []),
    el('td', { className: 'desc', text: entry.description }, []),
    el('td', {}, [el('span', { className: `status ${entry.status}`, text: statusLabel(entry.status) }, [])]),
    el('td', { className: 'nowrap', text: formatTime(start) }, []),
    el('td', { className: 'nowrap', text: end }, []),
    durationCell,
    el('td', { className: 'num', text: segments.length.toString() }, []),
    el('td', { className: 'actions' }, renderActions(entry))
  ]);
}

/**
 * Durations of a running task change every minute, so they are refreshed apart from the table.
 */
function renderDurations() {
  const now = Date.now();
  let total = 0;
  const totals = new Map<string, number>();
  for (const entry of rows) {
    const duration = entryDuration(entry, currentRange, now);
    total += duration;
    const name = entry.project || 'Без проекта';
    totals.set(name, (totals.get(name) ?? 0) + duration);
    const cell = durationCells.get(entry.id);
    if (cell) {
      cell.textContent = formatDuration(duration);
    }
  }

  totalLabel.textContent = formatDuration(total);
  totalDurationCell.textContent = formatDuration(total);
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  projectTotals.replaceChildren(...sorted.map(item =>
    el('span', { className: 'chip' }, [item[0], el('b', { text: formatDuration(item[1]) }, [])])));
}

async function render() {
  const entries = await getEntries();
  const projects = await getProjects();
  renderProjectOptions(projects);

  const range = getRange(filters.period, filters.from, filters.to, new Date());
  currentRange = range;
  rows = [];
  durationCells.clear();

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
    rangeLabel.textContent = `${formatDate(range.start)} — ${formatDate(subDays(range.end, 1))}`;
    rowsBody.replaceChildren(...rows.map(entry => renderRow(entry, range)));
  } else {
    rangeLabel.textContent = 'Выберите корректный диапазон дат';
    rowsBody.replaceChildren();
  }

  emptyMessage.hidden = rows.length > 0;
  totalsRow.hidden = rows.length === 0;
  totalSessionsCell.textContent = range ? countSessions(rows, range).toString() : '0';
  renderDurations();
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
    editHeading.textContent = 'Редактирование';
    titleInput.value = entry.title;
    descriptionInput.value = entry.description;
    projectInput.value = entry.project;
    for (const segment of entry.segments) {
      addSegmentRow(segment);
    }
  } else {
    const now = new Date();
    editHeading.textContent = 'Новая запись';
    titleInput.value = '';
    descriptionInput.value = '';
    projectInput.value = filters.project === '__none__' ? '' : filters.project;
    addSegmentRow({ end: now.getTime(), start: subHours(now, 1).getTime() });
  }

  editError.textContent = '';
  editDialog.showModal();
  titleInput.focus();
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

  const draft = {
    description: descriptionInput.value,
    project: projectInput.value,
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

// CSV export with translation to English

// Translations stay around while the page is open, so a second export does not translate the
// same project names again.
const translationCache = new Map<string, string>();

async function detectLanguage(detector: LanguageDetectorInstance, text: string) {
  const results = await detector.detect(text);
  const top = results.at(0);
  if (!top) {
    return null;
  }

  const language = top.detectedLanguage;
  if (language === 'en') {
    return null;
  }
  if (language === 'und') {
    return null;
  }

  // Short Latin-only text such as "API fix" is often misdetected, so we only trust it when the
  // detector is very sure.
  const minimum = /^\p{ASCII}*$/u.test(text) ? 0.8 : 0.3;
  if (top.confidence < minimum) {
    return null;
  }
  return language;
}

async function translateGroupUnsafe(api: TranslatorStatic, language: string, texts: string[], translations: Map<string, string>) {
  const availability = await api.availability({ sourceLanguage: language, targetLanguage: 'en' });
  if (availability === 'unavailable') {
    return false;
  }

  const translator = await api.create({
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', function onDownloadProgress(event) {
        setStatus(`Загрузка модели перевода ${language}→en: ${Math.round(event.loaded * 100)}%`);
      });
    },
    sourceLanguage: language,
    targetLanguage: 'en'
  });

  setStatus(`Перевод с ${language}…`);
  for (const text of texts) {
    const translated = await translator.translate(text);
    translationCache.set(text, translated);
    translations.set(text, translated);
  }
  translator.destroy();
  return true;
}

/**
 * Translates every text in one language. Returns false when this language could not be
 * translated, so the texts stay as they are.
 */
async function translateGroup(api: TranslatorStatic, language: string, texts: string[], translations: Map<string, string>) {
  try {
    const translated = await translateGroupUnsafe(api, language, texts, translations);
    return translated;
  } catch (error) {
    // Chrome refuses to download a model without a fresh click. That one the person can fix, so
    // we let it reach them instead of quietly skipping the language.
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw error;
    }
    console.warn('Translation failed', language, error);
    return false;
  }
}

/**
 * Translates texts to English with Chrome's on-device models. Returns null when this Chrome has
 * no translation support. Texts already in English, or in a language we could not tell, are left
 * out of the result.
 */
async function translateToEnglish(texts: string[]) {
  const detectorApi = window.LanguageDetector;
  if (!detectorApi) {
    return null;
  }
  const translatorApi = window.Translator;
  if (!translatorApi) {
    return null;
  }

  const translations = new Map<string, string>();
  const failedLanguages: string[] = [];
  const pending: string[] = [];
  for (const text of new Set(texts)) {
    if (!/\p{L}/u.test(text)) {
      continue;
    }
    const cached = translationCache.get(text);
    if (cached === undefined) {
      pending.push(text);
    } else {
      translations.set(text, cached);
    }
  }
  if (pending.length === 0) {
    return { failedLanguages, translations };
  }

  setStatus('Определение языка…');
  const detector = await detectorApi.create();
  const byLanguage = new Map<string, string[]>();
  for (const text of pending) {
    const language = await detectLanguage(detector, text);
    if (language === null) {
      continue;
    }
    const group = byLanguage.get(language);
    if (group) {
      group.push(text);
    } else {
      byLanguage.set(language, [text]);
    }
  }
  detector.destroy();

  for (const group of byLanguage.entries()) {
    const translated = await translateGroup(translatorApi, group[0], group[1], translations);
    if (!translated) {
      failedLanguages.push(group[0]);
    }
  }
  return { failedLanguages, translations };
}

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

function csvRow(entry: Entry, range: Range, translations: Map<string, string>, email: string, now: number) {
  const segments = segmentsInRange(entry, range);
  const start = new Date(segments[0].start);
  const lastEnd = segments[segments.length - 1].end;
  const duration = entryDuration(entry, range, now);
  return [
    formatDate(start),
    translations.get(entry.project) ?? entry.project,
    translations.get(entry.title) ?? entry.title,
    translations.get(entry.description) ?? entry.description,
    statusLabelEnglish(entry.status),
    formatDateTime(start),
    lastEnd === null ? '' : formatDateTime(new Date(lastEnd)),
    formatDuration(duration),
    formatHours(duration),
    segments.length.toString(),
    email
  ];
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

  let translations = new Map<string, string>();
  let note = '';
  if (translateCheckbox.checked) {
    const texts: string[] = [];
    for (const entry of rows) {
      texts.push(entry.title, entry.description, entry.project);
    }
    const result = await translateToEnglish(texts);
    if (result === null) {
      note = ' Перевод недоступен в этой версии Chrome (нужен Chrome 138+ на компьютере) — текст выгружен как есть.';
    } else {
      translations = result.translations;
      if (result.failedLanguages.length > 0) {
        note = ` Не удалось перевести с языков: ${result.failedLanguages.join(', ')} — эти тексты оставлены как есть.`;
      }
    }
  }

  const email = await getEmail();
  const now = Date.now();
  const exported = [...rows].sort((a, b) => firstStart(a, range) - firstStart(b, range));
  const lines = [[
    'Date',
    'Project',
    'Title',
    'Description',
    'Status',
    'Start',
    'End',
    'Duration (h:mm)',
    'Duration (hours)',
    'Sessions',
    'User'
  ]];
  let total = 0;
  for (const entry of exported) {
    lines.push(csvRow(entry, range, translations, email, now));
    total += entryDuration(entry, range, now);
  }
  lines.push([
    'Total',
    '',
    '',
    '',
    '',
    '',
    '',
    formatDuration(total),
    formatHours(total),
    countSessions(exported, range).toString(),
    ''
  ]);

  downloadFile(
    `time-tracker_${formatDate(range.start)}_${formatDate(subDays(range.end, 1))}.csv`,
    buildCsv(lines),
    'text/csv;charset=utf-8'
  );
  setStatus(`Готово: выгружено записей — ${exported.length}.${note}`);
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
    setStatus('Chrome не разрешил скачать модель перевода — нажмите «Экспорт CSV» ещё раз.');
    return;
  }
  setStatus(`Ошибка экспорта: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
}

// Backups

async function saveBackup() {
  const backup = await createBackup();
  downloadFile(`time-tracker-backup_${formatDate(new Date())}.json`, JSON.stringify(backup, null, 2), 'application/json');
  setStatus(`Резервная копия сохранена: записей — ${backup.entries.length}.`);
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
});

setInterval(function refreshRunningDurations() {
  if (rows.some(entry => entry.status === 'running')) {
    renderDurations();
  }
}, 15000);

async function init() {
  syncPeriodControls();
  await render();
  if (location.hash === '#new') {
    history.replaceState(null, '', location.pathname);
    openEditor(null);
  }
}

init().catch(console.warn);
renderUser().catch(console.warn);
renderAutoBackup().catch(console.warn);

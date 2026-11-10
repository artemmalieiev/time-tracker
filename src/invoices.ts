import { addDays, format } from 'date-fns';
import { byId, el } from './lib/dom';
import type { Client, Invoice, InvoiceItem, ItemKind, Payee } from './lib/invoices';
import {
  createInvoice,
  deleteClient,
  deleteInvoice,
  deletePayee,
  formatMoney,
  formatMoneyInput,
  getClients,
  getInvoice,
  getInvoices,
  getPayees,
  invoiceTotals,
  itemAmount,
  itemQuantity,
  itemRate,
  mergeItems,
  nextNumber,
  parseMoney,
  saveClient,
  savePayee,
  splitItem,
  updateInvoice
} from './lib/invoices';
import { formatDate, formatDurationWords, parseInputDate, parsePublicDuration, splitDuration } from './lib/time';

// The invoices page. "#list" shows invoices, clients and payees, and "#edit=<id>" edits one
// invoice next to a live copy of the paper it prints as. The paper is in English, like the CSV.
// Printing hides everything but the paper, so Chrome's «Save as PDF» gives the invoice file.

const listView = byId('list-view', HTMLElement);
const listStatus = byId('list-status', HTMLParagraphElement);
const newInvoiceButton = byId('btn-new-invoice', HTMLButtonElement);
const invoiceRows = byId('invoice-rows', HTMLTableSectionElement);
const invoicesEmpty = byId('invoices-empty', HTMLParagraphElement);
const addClientButton = byId('btn-add-client', HTMLButtonElement);
const clientRows = byId('client-rows', HTMLTableSectionElement);
const clientsEmpty = byId('clients-empty', HTMLParagraphElement);
const addPayeeButton = byId('btn-add-payee', HTMLButtonElement);
const payeeRows = byId('payee-rows', HTMLTableSectionElement);
const payeesEmpty = byId('payees-empty', HTMLParagraphElement);

const editView = byId('edit-view', HTMLElement);
const saveState = byId('save-state', HTMLSpanElement);
const deleteInvoiceButton = byId('btn-delete-invoice', HTMLButtonElement);
const printButton = byId('btn-print', HTMLButtonElement);
const invoiceForm = byId('invoice-form', HTMLFormElement);
const clientSelect = byId('i-client', HTMLSelectElement);
const payeeSelect = byId('i-payee', HTMLSelectElement);
const numberInput = byId('i-number', HTMLInputElement);
const currencySelect = byId('i-currency', HTMLSelectElement);
const dateInput = byId('i-date', HTMLInputElement);
const dueInput = byId('i-due', HTMLInputElement);
const rateInput = byId('i-rate', HTMLInputElement);
const taxInput = byId('i-tax', HTMLInputElement);
const mergeButton = byId('btn-merge', HTMLButtonElement);
const addItemButton = byId('btn-add-item', HTMLButtonElement);
const itemsContainer = byId('items', HTMLDivElement);
const editorError = byId('editor-error', HTMLParagraphElement);
const paper = byId('paper', HTMLElement);

const clientDialog = byId('client-dialog', HTMLDialogElement);
const clientForm = byId('client-form', HTMLFormElement);
const clientHeading = byId('client-heading', HTMLHeadingElement);
const clientNameInput = byId('c-name', HTMLInputElement);
const clientDetailsInput = byId('c-details', HTMLTextAreaElement);
const clientPayeeSelect = byId('c-payee', HTMLSelectElement);
const clientCurrencySelect = byId('c-currency', HTMLSelectElement);
const clientRateInput = byId('c-rate', HTMLInputElement);
const clientDueInput = byId('c-due', HTMLInputElement);
const clientError = byId('client-error', HTMLParagraphElement);
const clientCancelButton = byId('client-cancel', HTMLButtonElement);

const payeeDialog = byId('payee-dialog', HTMLDialogElement);
const payeeForm = byId('payee-form', HTMLFormElement);
const payeeHeading = byId('payee-heading', HTMLHeadingElement);
const payeeNameInput = byId('p-name', HTMLInputElement);
const payeeDetailsInput = byId('p-details', HTMLTextAreaElement);
const payeeError = byId('payee-error', HTMLParagraphElement);
const payeeCancelButton = byId('payee-cancel', HTMLButtonElement);

const mergeDialog = byId('merge-dialog', HTMLDialogElement);
const mergeForm = byId('merge-form', HTMLFormElement);
const mergeSummary = byId('merge-summary', HTMLParagraphElement);
const mergeTitleInput = byId('m-title', HTMLInputElement);
const mergeError = byId('merge-error', HTMLParagraphElement);
const mergeCancelButton = byId('merge-cancel', HTMLButtonElement);

let invoices: Invoice[] = [];
let clients: Client[] = [];
let payees: Payee[] = [];

/**
 * The invoice open in the editor. Every change goes here first and is then saved.
 */
let current: Invoice | null = null;

/**
 * Ids of the lines ticked for merging.
 */
const selected = new Set<string>();

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'неизвестная ошибка';
}

function option(text: string, value: string) {
  return el('option', { text, value }, []);
}

function currencyOptions(select: HTMLSelectElement, value: string) {
  const codes = ['USD', 'EUR', 'GBP', 'UAH', 'PLN'];
  if (!codes.includes(value)) {
    codes.push(value);
  }
  select.replaceChildren(...codes.map(code => option(code, code)));
  select.value = value;
}

function payeeOptions(select: HTMLSelectElement, value: string | null) {
  select.replaceChildren(option('— не выбран —', ''), ...payees.map(payee => option(payee.name, payee.id)));
  select.value = value ?? '';
}

function payeeName(id: string | null) {
  const payee = payees.find(item => item.id === id);
  return payee ? payee.name : '—';
}

async function loadAll() {
  invoices = await getInvoices();
  clients = await getClients();
  payees = await getPayees();
}

// List view

function renderInvoiceRow(invoice: Invoice) {
  const totals = invoiceTotals(invoice);
  const link = el('a', { text: 'Открыть' }, []);
  link.href = `#edit=${invoice.id}`;
  return el('tr', { dataset: { id: invoice.id } }, [
    el('td', { className: 'nowrap', text: invoice.number.toString() }, []),
    el('td', { className: 'nowrap', text: invoice.date }, []),
    el('td', { text: invoice.client.name || '—' }, []),
    el('td', { text: invoice.payee.name || '—' }, []),
    el('td', { className: 'num', text: formatMoney(totals.total, invoice.currency) }, []),
    el('td', { className: 'actions' }, [link, el('button', { className: 'small quiet danger', dataset: { action: 'delete' }, text: 'Удалить' }, [])])
  ]);
}

function renderClientRow(client: Client) {
  return el('tr', { dataset: { id: client.id } }, [
    el('td', {}, [
      el('div', { className: 'task-title', text: client.name }, []),
      el('div', { className: 'task-description', text: client.details }, [])
    ]),
    el('td', { text: payeeName(client.payee_id) }, []),
    el('td', { className: 'num', text: formatMoney(client.hourly_rate, client.currency) }, []),
    el('td', { className: 'num', text: `${client.due_days} дн.` }, []),
    el('td', { className: 'actions' }, [
      el('button', { className: 'small quiet', dataset: { action: 'edit' }, text: 'Изменить' }, []),
      el('button', { className: 'small quiet danger', dataset: { action: 'delete' }, text: 'Удалить' }, [])
    ])
  ]);
}

function renderPayeeRow(payee: Payee) {
  return el('tr', { dataset: { id: payee.id } }, [
    el('td', { className: 'task-title', text: payee.name }, []),
    el('td', {}, [el('div', { className: 'task-description', text: payee.details }, [])]),
    el('td', { className: 'actions' }, [
      el('button', { className: 'small quiet', dataset: { action: 'edit' }, text: 'Изменить' }, []),
      el('button', { className: 'small quiet danger', dataset: { action: 'delete' }, text: 'Удалить' }, [])
    ])
  ]);
}

async function renderList() {
  await loadAll();
  invoiceRows.replaceChildren(...invoices.map(renderInvoiceRow));
  invoicesEmpty.hidden = invoices.length > 0;
  clientRows.replaceChildren(...clients.map(renderClientRow));
  clientsEmpty.hidden = clients.length > 0;
  payeeRows.replaceChildren(...payees.map(renderPayeeRow));
  payeesEmpty.hidden = payees.length > 0;
}

/**
 * The id on the table row of a clicked action button, with the action it asks for.
 */
function rowAction(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return null;
  }
  const id = target.closest('tr')?.dataset.id;
  if (id === undefined) {
    return null;
  }
  return { action: target.dataset.action, id };
}

async function startEmptyInvoice() {
  const invoice = await createInvoice([], null, new Date());
  location.hash = `#edit=${invoice.id}`;
}

// Client and payee dialogs

let editingClient: Client | null = null;
let editingPayee: Payee | null = null;

function openClientDialog(client: Client | null) {
  editingClient = client;
  clientHeading.textContent = client ? 'Изменить клиента' : 'Новый клиент';
  clientNameInput.value = client ? client.name : '';
  clientDetailsInput.value = client ? client.details : '';
  payeeOptions(clientPayeeSelect, client ? client.payee_id : (payees.at(0)?.id ?? null));
  currencyOptions(clientCurrencySelect, client ? client.currency : 'USD');
  clientRateInput.value = client ? formatMoneyInput(client.hourly_rate) : '';
  clientDueInput.value = client ? client.due_days.toString() : '7';
  clientError.textContent = '';
  clientDialog.showModal();
  clientNameInput.focus();
}

async function submitClient() {
  const rate = clientRateInput.value.trim() === '' ? 0 : parseMoney(clientRateInput.value);
  if (rate === null) {
    clientError.textContent = 'Ставка — число, например 25 или 25.50.';
    return;
  }
  if (!/^\d+$/.test(clientDueInput.value.trim())) {
    clientError.textContent = 'Срок оплаты — целое число дней.';
    return;
  }

  await saveClient(editingClient ? editingClient.id : null, {
    currency: clientCurrencySelect.value,
    details: clientDetailsInput.value,
    due_days: parseInt(clientDueInput.value, 10),
    hourly_rate: rate,
    name: clientNameInput.value,
    payee_id: clientPayeeSelect.value || null
  });
  clientDialog.close();
}

function openPayeeDialog(payee: Payee | null) {
  editingPayee = payee;
  payeeHeading.textContent = payee ? 'Изменить исполнителя' : 'Новый исполнитель';
  payeeNameInput.value = payee ? payee.name : '';
  payeeDetailsInput.value = payee ? payee.details : '';
  payeeError.textContent = '';
  payeeDialog.showModal();
  payeeNameInput.focus();
}

async function submitPayee() {
  await savePayee(editingPayee ? editingPayee.id : null, { details: payeeDetailsInput.value, name: payeeNameInput.value });
  payeeDialog.close();
}

// Editor

/**
 * Inputs of one line in the editor, so a change updates the line without rebuilding the list
 * and the cursor stays where it is.
 */
interface ItemRow {
  amount: HTMLSpanElement;

  check: HTMLInputElement;

  item: InvoiceItem;
}

const itemRows = new Map<string, ItemRow>();

function numberInputOf(value: string, label: string, className: string) {
  const input = el('input', { className, type: 'number', value }, []);
  input.min = '0';
  input.step = '1';
  input.inputMode = 'numeric';
  input.setAttribute('aria-label', label);
  return input;
}

function textInputOf(value: string, label: string, className: string) {
  const input = el('input', { className, value }, []);
  input.autocomplete = 'off';
  input.setAttribute('aria-label', label);
  return input;
}

/**
 * Hours and minutes of an hourly line, or the number of units of a fixed line.
 */
function renderQuantity(item: InvoiceItem) {
  if (item.kind === 'fixed') {
    const units = numberInputOf(item.quantity.toString(), 'Количество', 'qty');
    units.dataset.field = 'quantity';
    return el('div', { className: 'quantity' }, [units, el('span', { className: 'muted', text: 'шт.' }, [])]);
  }

  const parts = splitDuration(item.duration);
  const hours = numberInputOf(parts.hours.toString(), 'Часы', 'qty');
  hours.dataset.field = 'hours';
  const minutes = numberInputOf(parts.minutes.toString(), 'Минуты', 'qty');
  minutes.max = '59';
  minutes.dataset.field = 'minutes';
  return el('div', { className: 'quantity' }, [
    hours,
    el('span', { className: 'muted', text: 'ч' }, []),
    minutes,
    el('span', { className: 'muted', text: 'мин' }, [])
  ]);
}

/**
 * Says how many lines a merged line holds, with a button to split it back. Empty for other lines.
 */
function renderMergeNote(item: InvoiceItem) {
  const note = el('div', { className: 'item-note' }, []);
  if (item.parts) {
    note.append(
      el('span', { className: 'muted', text: `Объединено позиций: ${item.parts.length}` }, []),
      el('button', { className: 'small quiet', dataset: { field: 'split' }, text: 'Разъединить', title: 'Вернуть позиции, из которых собрана эта', type: 'button' }, [])
    );
  }
  return note;
}

function renderItem(item: InvoiceItem, invoice: Invoice) {
  const check = el('input', { type: 'checkbox' }, []);
  check.checked = selected.has(item.id);
  check.disabled = item.kind !== 'hourly';
  check.dataset.field = 'selected';
  check.setAttribute('aria-label', 'Отметить для объединения');

  const title = textInputOf(item.title, 'Название позиции', 'item-title');
  title.dataset.field = 'title';
  title.placeholder = 'Название позиции';

  const kind = el('select', { className: 'kind' }, [option('Почасовая', 'hourly'), option('Фикс. цена', 'fixed')]);
  kind.value = item.kind;
  kind.dataset.field = 'kind';
  kind.setAttribute('aria-label', 'Тип позиции');

  const rate = textInputOf(item.rate === null ? '' : formatMoneyInput(item.rate), item.kind === 'hourly' ? 'Ставка в час' : 'Цена', 'rate');
  rate.dataset.field = 'rate';
  rate.inputMode = 'decimal';
  rate.placeholder = item.kind === 'hourly' ? formatMoneyInput(invoice.hourly_rate) : 'цена';
  rate.title = item.kind === 'hourly' ? 'Ставка в час. Пусто — ставка инвойса' : 'Цена за штуку';

  const amount = el('span', { className: 'amount', text: formatMoney(itemAmount(item, invoice), invoice.currency) }, []);
  const remove = el('button', { className: 'small quiet danger', dataset: { field: 'remove' }, text: '✕', title: 'Удалить позицию', type: 'button' }, []);

  const row = el('div', { className: 'item', dataset: { id: item.id } }, [
    check,
    el('div', { className: 'item-main' }, [title, renderMergeNote(item)]),
    kind,
    renderQuantity(item),
    rate,
    amount,
    remove
  ]);
  itemRows.set(item.id, { amount, check, item });
  return row;
}

function renderItems() {
  const invoice = current;
  if (!invoice) {
    return;
  }
  itemRows.clear();
  const ids = new Set(invoice.items.map(item => item.id));
  for (const id of [...selected]) {
    if (!ids.has(id)) {
      selected.delete(id);
    }
  }
  const rows: HTMLDivElement[] = [];
  for (const item of invoice.items) {
    rows.push(renderItem(item, invoice));
  }
  if (rows.length === 0) {
    itemsContainer.replaceChildren(el('p', { className: 'muted empty-items', text: 'Позиций нет. Добавьте позицию вручную.' }, []));
  } else {
    itemsContainer.replaceChildren(...rows);
  }
  syncMergeButton();
}

/**
 * Only hourly lines merge, and it takes two of them.
 */
function chosenHourly() {
  const chosen: InvoiceItem[] = [];
  for (const row of itemRows.values()) {
    if (selected.has(row.item.id) && row.item.kind === 'hourly') {
      chosen.push(row.item);
    }
  }
  return chosen;
}

function syncMergeButton() {
  mergeButton.disabled = chosenHourly().length < 2;
}

function refreshAmounts() {
  const invoice = current;
  if (!invoice) {
    return;
  }
  for (const row of itemRows.values()) {
    row.amount.textContent = formatMoney(itemAmount(row.item, invoice), invoice.currency);
  }
}

function fillHeader(invoice: Invoice) {
  const clientOptions = [option('— не выбран —', ''), ...clients.map(client => option(client.name, client.id))];
  clientSelect.replaceChildren(...clientOptions);
  clientSelect.value = clients.some(client => client.id === invoice.client_id) ? invoice.client_id ?? '' : '';
  payeeOptions(payeeSelect, payees.some(payee => payee.id === invoice.payee_id) ? invoice.payee_id : null);
  numberInput.value = invoice.number.toString();
  currencyOptions(currencySelect, invoice.currency);
  dateInput.value = invoice.date;
  dueInput.value = invoice.due_date;
  rateInput.value = formatMoneyInput(invoice.hourly_rate);
  taxInput.value = invoice.tax_percent.toString();
}

async function openEditor(id: string) {
  await loadAll();
  const invoice = await getInvoice(id);
  if (!invoice) {
    listStatus.textContent = 'Инвойс не найден — возможно, его удалили.';
    location.hash = '#list';
    return;
  }

  current = invoice;
  selected.clear();
  editorError.textContent = '';
  saveState.textContent = '';
  fillHeader(invoice);
  renderItems();
  renderPaper();
  listView.hidden = true;
  editView.hidden = false;
}

let saveCount = 0;

/**
 * Saves the invoice in the editor. Saves queue up in storage, so the last change always wins.
 */
function save() {
  const invoice = current;
  if (!invoice) {
    return;
  }
  saveCount++;
  const mine = saveCount;
  saveState.textContent = 'Сохранение…';
  updateInvoice(structuredClone(invoice)).then(function onSaved() {
    if (mine === saveCount) {
      saveState.textContent = 'Сохранено';
    }
  }, function onSaveFailed(error) {
    console.warn(error);
    saveState.textContent = `Не сохранено: ${errorText(error)}`;
  });
}

function changed() {
  refreshAmounts();
  renderPaper();
  save();
}

function chooseClient(invoice: Invoice, id: string) {
  const client = clients.find(item => item.id === id);
  if (!client) {
    invoice.client_id = null;
    invoice.client = { details: '', name: '' };
    return;
  }

  invoice.client_id = client.id;
  invoice.client = { details: client.details, name: client.name };
  invoice.currency = client.currency;
  invoice.hourly_rate = client.hourly_rate;
  const date = parseInputDate(invoice.date) ?? new Date();
  invoice.due_date = formatDate(addDays(date, client.due_days));
  if (client.payee_id !== null) {
    choosePayee(invoice, client.payee_id);
  }
}

function choosePayee(invoice: Invoice, id: string) {
  const payee = payees.find(item => item.id === id);
  invoice.payee_id = payee ? payee.id : null;
  invoice.payee = payee ? { details: payee.details, name: payee.name } : { details: '', name: '' };
  // Numbers run per payee, so a new payee gets the number after its own last one.
  const others = invoices.filter(item => item.id !== invoice.id);
  invoice.number = nextNumber(others, invoice.payee_id);
}

/**
 * Reads the header field that changed into the invoice. Returns the problem to show, or an empty
 * string when the value is fine.
 */
function readHeader(invoice: Invoice, target: EventTarget | null) {
  if (target === numberInput) {
    if (!/^\d+$/.test(numberInput.value)) {
      return 'Номер — целое число.';
    }
    invoice.number = parseInt(numberInput.value, 10);
  } else if (target === dateInput) {
    invoice.date = dateInput.value;
  } else if (target === dueInput) {
    invoice.due_date = dueInput.value;
  } else if (target === currencySelect) {
    invoice.currency = currencySelect.value;
  } else if (target === rateInput) {
    const rate = rateInput.value.trim() === '' ? 0 : parseMoney(rateInput.value);
    if (rate === null) {
      return 'Ставка — число, например 25 или 25.50.';
    }
    invoice.hourly_rate = rate;
  } else if (target === taxInput) {
    const text = taxInput.value.trim().replace(',', '.');
    if (text !== '' && !/^\d+(\.\d+)?$/.test(text)) {
      return 'Налог — число процентов, например 0 или 20.';
    }
    invoice.tax_percent = text === '' ? 0 : parseFloat(text);
  }
  return '';
}

function onHeaderChange(target: EventTarget | null) {
  const invoice = current;
  if (!invoice) {
    return;
  }

  if (target === clientSelect) {
    chooseClient(invoice, clientSelect.value);
    fillHeader(invoice);
    renderItems();
  } else if (target === payeeSelect) {
    choosePayee(invoice, payeeSelect.value);
    numberInput.value = invoice.number.toString();
  } else {
    const problem = readHeader(invoice, target);
    editorError.textContent = problem;
    if (problem) {
      return;
    }
    if (target === rateInput) {
      // Hourly lines without a rate of their own show the invoice rate as a placeholder.
      renderItems();
    }
  }
  changed();
}

/**
 * Reads the line field that changed into the line. Returns the problem to show, or an empty
 * string when the value is fine.
 */
function readItemField(item: InvoiceItem, input: HTMLInputElement, row: Element) {
  switch (input.dataset.field) {
    case 'title':
      item.title = input.value;
      return '';
    case 'quantity':
      if (!/^\d+$/.test(input.value)) {
        return 'Количество — целое число.';
      }
      item.quantity = parseInt(input.value, 10);
      return '';
    case 'hours':
    case 'minutes': {
      const hours = row.querySelector<HTMLInputElement>('input[data-field="hours"]');
      const minutes = row.querySelector<HTMLInputElement>('input[data-field="minutes"]');
      const parsed = parsePublicDuration(hours ? hours.value : '', minutes ? minutes.value : '');
      if (parsed.error !== null) {
        return parsed.error;
      }
      item.duration = parsed.milliseconds ?? 0;
      return '';
    }
    case 'rate': {
      if (input.value.trim() === '') {
        item.rate = null;
        return '';
      }
      const rate = parseMoney(input.value);
      if (rate === null) {
        return 'Ставка — число, например 25 или 25.50.';
      }
      item.rate = rate;
      return '';
    }
    default:
      return '';
  }
}

function onItemInput(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  const row = target.closest('.item');
  if (!(row instanceof HTMLDivElement)) {
    return;
  }
  const itemRow = itemRows.get(row.dataset.id ?? '');
  if (!itemRow) {
    return;
  }

  if (target.dataset.field === 'selected') {
    if (target.checked) {
      selected.add(itemRow.item.id);
    } else {
      selected.delete(itemRow.item.id);
    }
    syncMergeButton();
    return;
  }

  const problem = readItemField(itemRow.item, target, row);
  editorError.textContent = problem;
  if (!problem) {
    changed();
  }
}

function setKind(item: InvoiceItem, kind: ItemKind) {
  item.kind = kind;
  if (kind === 'fixed') {
    selected.delete(item.id);
    if (item.quantity < 1) {
      item.quantity = 1;
    }
  }
}

function onItemsChange(event: Event) {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.dataset.field === 'kind') {
    const id = target.closest<HTMLElement>('.item')?.dataset.id ?? '';
    const itemRow = itemRows.get(id);
    if (itemRow) {
      setKind(itemRow.item, target.value === 'fixed' ? 'fixed' : 'hourly');
      renderItems();
      changed();
    }
  }
}

function removeItem(invoice: Invoice, id: string) {
  invoice.items = invoice.items.filter(item => item.id !== id);
  selected.delete(id);
}

function splitMerged(invoice: Invoice, id: string) {
  const split = splitItem(invoice.items, id);
  if (split === null) {
    return;
  }
  invoice.items = split;
  selected.delete(id);
}

function onItemsClick(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const invoice = current;
  if (!invoice) {
    return;
  }
  const id = target.closest<HTMLElement>('.item')?.dataset.id ?? '';
  if (target.dataset.field === 'remove') {
    removeItem(invoice, id);
  } else if (target.dataset.field === 'split') {
    splitMerged(invoice, id);
  } else {
    return;
  }
  editorError.textContent = '';
  renderItems();
  changed();
}

function addItem() {
  const invoice = current;
  if (!invoice) {
    return;
  }
  const item: InvoiceItem = { duration: 0, entry_ids: [], id: crypto.randomUUID(), kind: 'hourly', quantity: 1, rate: null, title: '' };
  invoice.items.push(item);
  renderItems();
  changed();
  const title = itemsContainer.querySelector<HTMLInputElement>(`.item[data-id="${item.id}"] .item-title`);
  title?.focus();
}

function openMergeDialog() {
  const chosen = chosenHourly();
  if (chosen.length < 2) {
    return;
  }
  let duration = 0;
  const titles: string[] = [];
  for (const item of chosen) {
    duration += item.duration;
    if (item.title.trim()) {
      titles.push(item.title.trim());
    }
  }
  mergeSummary.textContent = `Позиций: ${chosen.length}, время вместе: ${formatDurationWords(duration)}.`;
  mergeTitleInput.value = titles.join('; ');
  mergeError.textContent = '';
  mergeDialog.showModal();
  mergeTitleInput.select();
}

function submitMerge() {
  const invoice = current;
  if (!invoice) {
    return;
  }
  if (!mergeTitleInput.value.trim()) {
    mergeError.textContent = 'Укажите название.';
    return;
  }
  const ids: string[] = [];
  for (const item of chosenHourly()) {
    ids.push(item.id);
  }
  const merged = mergeItems(invoice.items, ids, mergeTitleInput.value);
  if (merged === null) {
    mergeError.textContent = 'Объединять можно только две или больше почасовых позиций.';
    return;
  }
  invoice.items = merged;
  selected.clear();
  mergeDialog.close();
  renderItems();
  changed();
}

function printInvoice() {
  const invoice = current;
  if (!invoice) {
    return;
  }
  // Chrome names the PDF after the page title.
  const title = document.title;
  document.title = `Invoice ${invoice.number}`;
  window.print();
  document.title = title;
}

async function removeCurrentInvoice() {
  const invoice = current;
  if (!invoice) {
    return;
  }
  if (!confirm(`Удалить инвойс № ${invoice.number}? Задачи в журнале не изменятся.`)) {
    return;
  }
  await deleteInvoice(invoice.id);
  current = null;
  location.hash = '#list';
}

// The paper

function printDate(value: string) {
  const date = parseInputDate(value);
  return date ? format(date, 'MMM d, yyyy') : '';
}

function printQuantity(value: number) {
  const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  return formatter.format(value);
}

function metaRow(label: string, value: string, className: string) {
  return el('div', { className: `paper-row ${className}` }, [el('dt', { text: label }, []), el('dd', { text: value }, [])]);
}

function paperItemRow(item: InvoiceItem, invoice: Invoice) {
  return el('tr', {}, [
    el('td', { className: 'paper-item', text: item.title }, []),
    el('td', { text: printQuantity(itemQuantity(item)) }, []),
    el('td', { className: 'paper-unit', text: item.kind === 'hourly' ? 'h' : '' }, []),
    el('td', { className: 'paper-num', text: formatMoney(itemRate(item, invoice), invoice.currency) }, []),
    el('td', { className: 'paper-num', text: formatMoney(itemAmount(item, invoice), invoice.currency) }, [])
  ]);
}

function renderPaper() {
  const invoice = current;
  if (!invoice) {
    return;
  }
  const totals = invoiceTotals(invoice);

  const head = el('div', { className: 'paper-head' }, [
    el('div', { className: 'paper-party' }, [
      el('div', { className: 'paper-name', text: invoice.payee.name }, []),
      el('div', { className: 'paper-lines', text: invoice.payee.details }, [])
    ]),
    el('div', { className: 'paper-heading' }, [
      el('div', { className: 'paper-title', text: 'INVOICE' }, []),
      el('div', { className: 'paper-number', text: `# ${invoice.number}` }, [])
    ])
  ]);

  const middle = el('div', { className: 'paper-middle' }, [
    el('div', { className: 'paper-party' }, [
      el('div', { className: 'paper-label', text: 'Bill To:' }, []),
      el('div', { className: 'paper-name', text: invoice.client.name }, []),
      el('div', { className: 'paper-lines', text: invoice.client.details }, [])
    ]),
    el('dl', { className: 'paper-meta' }, [
      metaRow('Date:', printDate(invoice.date), ''),
      metaRow('Due Date:', printDate(invoice.due_date), ''),
      metaRow('Balance Due:', formatMoney(totals.total, invoice.currency), 'paper-balance')
    ])
  ]);

  const items = el('table', { className: 'paper-items' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Item' }, []),
      el('th', { text: 'Quantity' }, []),
      el('th', { className: 'paper-unit', text: 'Unit' }, []),
      el('th', { className: 'paper-num', text: 'Rate' }, []),
      el('th', { className: 'paper-num', text: 'Amount' }, [])
    ])]),
    el('tbody', {}, invoice.items.map(item => paperItemRow(item, invoice)))
  ]);

  const summary = el('dl', { className: 'paper-totals' }, [
    metaRow('Subtotal:', formatMoney(totals.subtotal, invoice.currency), ''),
    metaRow(`Tax (${printQuantity(invoice.tax_percent)}%):`, formatMoney(totals.tax, invoice.currency), ''),
    metaRow('Total:', formatMoney(totals.total, invoice.currency), '')
  ]);

  paper.replaceChildren(head, middle, items, summary);
}

// Routing

/**
 * The invoice id in "#edit=<id>", or null for any other address.
 */
function editedId() {
  const match = /^#edit=(.+)$/.exec(location.hash);
  return match ? match[1] : null;
}

async function route() {
  const id = editedId();
  if (id !== null) {
    return openEditor(id);
  }
  current = null;
  editView.hidden = true;
  listView.hidden = false;
  return renderList();
}

// Listeners

window.addEventListener('hashchange', function onHashChange() {
  route().catch(console.warn);
});

newInvoiceButton.addEventListener('click', function onNewInvoiceClick() {
  startEmptyInvoice().catch(function showNewInvoiceError(error) {
    console.warn(error);
    listStatus.textContent = `Не удалось: ${errorText(error)}`;
  });
});

invoiceRows.addEventListener('click', function onInvoiceRowsClick(event) {
  const clicked = rowAction(event);
  if (clicked?.action === 'delete') {
    const invoice = invoices.find(item => item.id === clicked.id);
    if (invoice && confirm(`Удалить инвойс № ${invoice.number}? Задачи в журнале не изменятся.`)) {
      deleteInvoice(invoice.id).catch(console.warn);
    }
  }
});

addClientButton.addEventListener('click', function onAddClientClick() {
  openClientDialog(null);
});

clientRows.addEventListener('click', function onClientRowsClick(event) {
  const clicked = rowAction(event);
  if (!clicked) {
    return;
  }
  const client = clients.find(item => item.id === clicked.id);
  if (!client) {
    return;
  }
  if (clicked.action === 'edit') {
    openClientDialog(client);
  } else if (clicked.action === 'delete' && confirm(`Удалить клиента «${client.name}»? Выставленные инвойсы сохранят его реквизиты.`)) {
    deleteClient(client.id).catch(console.warn);
  }
});

addPayeeButton.addEventListener('click', function onAddPayeeClick() {
  openPayeeDialog(null);
});

payeeRows.addEventListener('click', function onPayeeRowsClick(event) {
  const clicked = rowAction(event);
  if (!clicked) {
    return;
  }
  const payee = payees.find(item => item.id === clicked.id);
  if (!payee) {
    return;
  }
  if (clicked.action === 'edit') {
    openPayeeDialog(payee);
  } else if (clicked.action === 'delete' && confirm(`Удалить исполнителя «${payee.name}»? Выставленные инвойсы сохранят его реквизиты.`)) {
    deletePayee(payee.id).catch(function showDeletePayeeError(error) {
      listStatus.textContent = errorText(error);
    });
  }
});

clientForm.addEventListener('submit', function onClientSubmit(event) {
  event.preventDefault();
  submitClient().catch(function showClientError(error) {
    clientError.textContent = errorText(error);
  });
});

clientCancelButton.addEventListener('click', function onClientCancelClick() {
  clientDialog.close();
});

payeeForm.addEventListener('submit', function onPayeeSubmit(event) {
  event.preventDefault();
  submitPayee().catch(function showPayeeError(error) {
    payeeError.textContent = errorText(error);
  });
});

payeeCancelButton.addEventListener('click', function onPayeeCancelClick() {
  payeeDialog.close();
});

invoiceForm.addEventListener('submit', function onInvoiceFormSubmit(event) {
  event.preventDefault();
});

// Text fields update the invoice as the person types. Selects only report through change events.
invoiceForm.addEventListener('input', function onInvoiceFormInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (itemsContainer.contains(target)) {
    onItemInput(target);
  } else {
    onHeaderChange(target);
  }
});

invoiceForm.addEventListener('change', function onInvoiceFormChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }
  if (itemsContainer.contains(target)) {
    onItemsChange(event);
  } else {
    onHeaderChange(target);
  }
});

itemsContainer.addEventListener('click', onItemsClick);

mergeButton.addEventListener('click', function onMergeClick() {
  openMergeDialog();
});

addItemButton.addEventListener('click', function onAddItemClick() {
  addItem();
});

mergeForm.addEventListener('submit', function onMergeSubmit(event) {
  event.preventDefault();
  submitMerge();
});

mergeCancelButton.addEventListener('click', function onMergeCancelClick() {
  mergeDialog.close();
});

printButton.addEventListener('click', function onPrintClick() {
  printInvoice();
});

deleteInvoiceButton.addEventListener('click', function onDeleteInvoiceClick() {
  removeCurrentInvoice().catch(console.warn);
});

chrome.storage.onChanged.addListener(function onStorageChanged(changes, area) {
  if (area !== 'local') {
    return;
  }
  // The editor saves on every keystroke, so redrawing it from storage would move the cursor. Only
  // the list redraws.
  if (current !== null) {
    return;
  }
  if ('invoices' in changes || 'clients' in changes || 'payees' in changes) {
    renderList().catch(console.warn);
  }
});

if (!location.hash) {
  history.replaceState(null, '', '#list');
}
route().catch(console.warn);

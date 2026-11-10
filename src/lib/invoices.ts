import { addDays } from 'date-fns';
import { formatDate } from './time';
import { getKey } from './user';

// Invoices, the clients they go to and the payees whose bank details they carry. All three live
// in chrome.storage.local beside the entries, and like entries they belong to whoever is signed
// in to Chrome. An invoice keeps its own copy of the time it bills, so merging or editing its
// lines never touches the entries in the journal.
//
// Money is stored in whole cents, so sums never pick up floating point dust.

/**
 * Who issues invoices and gets paid: a name and free text with bank details and an address.
 */
export interface Payee {
  created_at: number;

  /**
   * Printed under the name line by line, as typed.
   */
  details: string;

  id: string;

  name: string;

  updated_at: number;

  user_email: string;
}

/**
 * Who an invoice is billed to.
 */
export interface Client {
  created_at: number;

  /**
   * An ISO 4217 code such as "USD".
   */
  currency: string;

  /**
   * Printed under the name line by line, as typed.
   */
  details: string;

  /**
   * Days from the invoice date to the due date.
   */
  due_days: number;

  /**
   * In cents.
   */
  hourly_rate: number;

  id: string;

  name: string;

  /**
   * The payee who bills this client by default, or null when none is chosen.
   */
  payee_id: string | null;

  updated_at: number;

  user_email: string;
}

/**
 * A name with the lines under it, as printed on the invoice.
 */
export interface Party {
  details: string;

  name: string;
}

export type ItemKind = 'fixed' | 'hourly';

/**
 * One line of an invoice.
 */
export interface InvoiceItem {
  /**
   * Billed time in milliseconds. Only used by hourly lines.
   */
  duration: number;

  /**
   * The journal entries this line was made from. Empty for a line added by hand.
   */
  entry_ids: string[];

  id: string;

  kind: ItemKind;

  /**
   * The lines this one was merged from, as they were just before the merge. Only a merged line has
   * them.
   */
  parts?: InvoiceItem[];

  /**
   * How many units a fixed price line bills. Only used by fixed lines.
   */
  quantity: number;

  /**
   * In cents: the price per hour of an hourly line, or the price per unit of a fixed line. Null on
   * an hourly line means the hourly rate of the invoice.
   */
  rate: number | null;

  title: string;
}

/**
 * Days the invoice lines were taken from, as "yyyy-MM-dd" with both days included.
 */
interface Period {
  from: string;

  to: string;
}

export interface Invoice {
  /**
   * A copy of the client as it was when chosen, so editing the client later keeps old invoices as
   * they were sent.
   */
  client: Party;

  client_id: string | null;

  created_at: number;

  currency: string;

  /**
   * As "yyyy-MM-dd".
   */
  date: string;

  /**
   * As "yyyy-MM-dd".
   */
  due_date: string;

  /**
   * In cents.
   */
  hourly_rate: number;

  id: string;

  items: InvoiceItem[];

  number: number;

  /**
   * A copy of the payee as it was when chosen.
   */
  payee: Party;

  payee_id: string | null;

  /**
   * The journal period the invoice was made from, or null for an invoice started empty.
   */
  period: Period | null;

  tax_percent: number;

  updated_at: number;

  user_email: string;
}

/**
 * A task from the journal with the time to bill for it.
 */
interface Task {
  duration: number;

  entry_id: string;

  title: string;
}

interface Store {
  clients: Client[];

  invoices: Invoice[];

  payees: Payee[];
}

async function readStore() {
  const items = await chrome.storage.local.get(['clients', 'invoices', 'payees']);
  const store: Store = {
    clients: <Client[] | undefined>items.clients ?? [],
    invoices: <Invoice[] | undefined>items.invoices ?? [],
    payees: <Payee[] | undefined>items.payees ?? []
  };
  return store;
}

// Writes go through a queue so that two quick changes cannot read the same data and then
// overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

function mutate<T>(change: (store: Store, user: string, now: number) => T) {
  const run = queue.then(async function applyChange() {
    const store = await readStore();
    const user = await getKey();
    const result = change(store, user, Date.now());
    await chrome.storage.local.set({ clients: store.clients, invoices: store.invoices, payees: store.payees });
    return result;
  });
  queue = run.catch(function keepQueueAlive(error) {
    console.debug('Queued invoice write failed', error);
  });
  return run;
}

function byName(a: Party, b: Party) {
  return a.name.localeCompare(b.name);
}

/**
 * Payees of the person signed in to Chrome, sorted by name.
 */
export async function getPayees() {
  const store = await readStore();
  const user = await getKey();
  return store.payees.filter(payee => payee.user_email === user).sort(byName);
}

/**
 * Clients of the person signed in to Chrome, sorted by name.
 */
export async function getClients() {
  const store = await readStore();
  const user = await getKey();
  return store.clients.filter(client => client.user_email === user).sort(byName);
}

/**
 * Invoices of the person signed in to Chrome, the newest first.
 */
export async function getInvoices() {
  const store = await readStore();
  const user = await getKey();
  const invoices = store.invoices.filter(invoice => invoice.user_email === user);
  invoices.sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
  return invoices;
}

export async function getInvoice(id: string) {
  const invoices = await getInvoices();
  return invoices.find(invoice => invoice.id === id) ?? null;
}

/**
 * Creates a payee when the id is null, otherwise replaces the fields of an existing one.
 */
export function savePayee(id: string | null, fields: Party) {
  const name = fields.name.trim();
  if (!name) {
    throw new Error('Укажите имя исполнителя');
  }

  return mutate(function save(store, user, now) {
    if (id === null) {
      const created: Payee = {
        created_at: now,
        details: fields.details.trim(),
        id: crypto.randomUUID(),
        name,
        updated_at: now,
        user_email: user
      };
      store.payees.push(created);
      return created;
    }

    const payee = findOwn(store.payees, user, id);
    payee.details = fields.details.trim();
    payee.name = name;
    payee.updated_at = now;
    return payee;
  });
}

/**
 * Deletes a payee. A payee some client is billed by stays, so no client loses its default.
 */
export function deletePayee(id: string) {
  return mutate(function remove(store, user) {
    for (const client of store.clients) {
      if (client.user_email === user && client.payee_id === id) {
        throw new Error(`Исполнитель выбран у клиента «${client.name}». Сначала смените его там.`);
      }
    }
    store.payees = store.payees.filter(payee => payee.id !== id || payee.user_email !== user);
  });
}

/**
 * What a person fills in for a client.
 */
interface ClientFields {
  currency: string;

  details: string;

  due_days: number;

  hourly_rate: number;

  name: string;

  payee_id: string | null;
}

/**
 * Creates a client when the id is null, otherwise replaces the fields of an existing one.
 */
export function saveClient(id: string | null, fields: ClientFields) {
  const name = fields.name.trim();
  if (!name) {
    throw new Error('Укажите название клиента');
  }

  return mutate(function save(store, user, now) {
    if (id === null) {
      const created: Client = {
        created_at: now,
        currency: fields.currency,
        details: fields.details.trim(),
        due_days: fields.due_days,
        hourly_rate: fields.hourly_rate,
        id: crypto.randomUUID(),
        name,
        payee_id: fields.payee_id,
        updated_at: now,
        user_email: user
      };
      store.clients.push(created);
      return created;
    }

    const client = findOwn(store.clients, user, id);
    client.currency = fields.currency;
    client.details = fields.details.trim();
    client.due_days = fields.due_days;
    client.hourly_rate = fields.hourly_rate;
    client.name = name;
    client.payee_id = fields.payee_id;
    client.updated_at = now;
    return client;
  });
}

/**
 * Deletes a client. Invoices already made for it keep their copy of its details.
 */
export function deleteClient(id: string) {
  return mutate(function remove(store, user) {
    store.clients = store.clients.filter(client => client.id !== id || client.user_email !== user);
  });
}

function findOwn<T extends { id: string; user_email: string; }>(items: T[], user: string, id: string) {
  for (const item of items) {
    if (item.id === id && item.user_email === user) {
      return item;
    }
  }
  throw new Error('Не найдено');
}

function findOwnOrNull<T extends { id: string; user_email: string; }>(items: T[], user: string, id: string | null) {
  for (const item of items) {
    if (item.id === id && item.user_email === user) {
      return item;
    }
  }
  return null;
}

function toParty(value: Party | null) {
  const party: Party = { details: value ? value.details : '', name: value ? value.name : '' };
  return party;
}

/**
 * The number after the highest one this payee has used, or 1 for a payee with no invoices yet.
 */
export function nextNumber(invoices: Invoice[], payeeId: string | null) {
  let highest = 0;
  for (const invoice of invoices) {
    if (invoice.payee_id === payeeId && invoice.number > highest) {
      highest = invoice.number;
    }
  }
  return highest + 1;
}

/**
 * Creates an invoice with one hourly line per task. It goes to the client of the last invoice, so
 * a person billing one client every month picks nothing.
 */
export function createInvoice(tasks: Task[], period: Period | null, today: Date) {
  return mutate(function create(store, user, now) {
    const own = store.invoices.filter(invoice => invoice.user_email === user);
    let last: Invoice | null = null;
    for (const invoice of own) {
      if (!last || invoice.created_at > last.created_at) {
        last = invoice;
      }
    }

    const client = findOwnOrNull(store.clients, user, last ? last.client_id : null);
    const payee = findOwnOrNull(store.payees, user, client ? client.payee_id : null);
    const items: InvoiceItem[] = [];
    for (const task of tasks) {
      items.push({
        duration: task.duration,
        entry_ids: [task.entry_id],
        id: crypto.randomUUID(),
        kind: 'hourly',
        quantity: 1,
        rate: null,
        title: task.title.trim()
      });
    }

    const created: Invoice = {
      client: toParty(client),
      client_id: client ? client.id : null,
      created_at: now,
      currency: client ? client.currency : 'USD',
      date: formatDate(today),
      due_date: formatDate(addDays(today, client ? client.due_days : 7)),
      hourly_rate: client ? client.hourly_rate : 0,
      id: crypto.randomUUID(),
      items,
      number: nextNumber(own, payee ? payee.id : null),
      payee: toParty(payee),
      payee_id: payee ? payee.id : null,
      period,
      tax_percent: last ? last.tax_percent : 0,
      updated_at: now,
      user_email: user
    };
    store.invoices.push(created);
    return created;
  });
}

/**
 * Saves everything a person can edit on an invoice.
 */
export function updateInvoice(invoice: Invoice) {
  return mutate(function update(store, user, now) {
    const saved = findOwn(store.invoices, user, invoice.id);
    saved.client = toParty(invoice.client);
    saved.client_id = invoice.client_id;
    saved.currency = invoice.currency;
    saved.date = invoice.date;
    saved.due_date = invoice.due_date;
    saved.hourly_rate = invoice.hourly_rate;
    saved.items = structuredClone(invoice.items);
    saved.number = invoice.number;
    saved.payee = toParty(invoice.payee);
    saved.payee_id = invoice.payee_id;
    saved.tax_percent = invoice.tax_percent;
    saved.updated_at = now;
  });
}

export function deleteInvoice(id: string) {
  return mutate(function remove(store, user) {
    store.invoices = store.invoices.filter(invoice => invoice.id !== id || invoice.user_email !== user);
  });
}

/**
 * Joins the chosen hourly lines into one line with their time added up, put where the first of
 * them was. Returns null when fewer than two lines are chosen or one of them is not hourly. The
 * rate carries over only when every chosen line had the same one. The merged line keeps the
 * chosen lines, so {@link splitItem} can bring them back.
 */
export function mergeItems(items: InvoiceItem[], ids: string[], title: string) {
  const chosen = items.filter(item => ids.includes(item.id));
  if (chosen.length < 2) {
    return null;
  }

  let duration = 0;
  const entryIds: string[] = [];
  let rate = chosen[0].rate;
  for (const item of chosen) {
    if (item.kind !== 'hourly') {
      return null;
    }
    duration += item.duration;
    for (const entryId of item.entry_ids) {
      if (!entryIds.includes(entryId)) {
        entryIds.push(entryId);
      }
    }
    if (item.rate !== rate) {
      rate = null;
    }
  }

  const merged: InvoiceItem = {
    duration,
    entry_ids: entryIds,
    id: crypto.randomUUID(),
    kind: 'hourly',
    parts: structuredClone(chosen),
    quantity: 1,
    rate,
    title: title.trim()
  };
  const result: InvoiceItem[] = [];
  for (const item of items) {
    if (item === chosen[0]) {
      result.push(merged);
    } else if (!chosen.includes(item)) {
      result.push(item);
    }
  }
  return result;
}

/**
 * Puts a merged line back as the lines it was made from, where it was. Changes made to the merged
 * line itself are dropped, and the lines come back as they were before the merge. Returns null
 * when the line was not merged.
 */
export function splitItem(items: InvoiceItem[], id: string) {
  const merged = items.find(item => item.id === id);
  if (!merged) {
    return null;
  }
  const parts = merged.parts;
  if (!parts) {
    return null;
  }

  const result: InvoiceItem[] = [];
  for (const item of items) {
    if (item === merged) {
      result.push(...structuredClone(parts));
    } else {
      result.push(item);
    }
  }
  return result;
}

/**
 * Hours of an hourly line rounded to hundredths, which is what the invoice prints. Amounts are
 * worked out from this rounded value, so quantity times rate always matches the amount printed.
 */
function hundredthsOfHour(duration: number) {
  return Math.round(duration / 36000);
}

/**
 * The quantity printed for a line: hours for an hourly line, units for a fixed one.
 */
export function itemQuantity(item: InvoiceItem) {
  return item.kind === 'hourly' ? hundredthsOfHour(item.duration) / 100 : item.quantity;
}

/**
 * The rate of a line in cents, with the invoice rate standing in for an hourly line without one.
 */
export function itemRate(item: InvoiceItem, invoice: Invoice) {
  if (item.rate !== null) {
    return item.rate;
  }
  return item.kind === 'hourly' ? invoice.hourly_rate : 0;
}

/**
 * The amount of a line in cents.
 */
export function itemAmount(item: InvoiceItem, invoice: Invoice) {
  const rate = itemRate(item, invoice);
  if (item.kind === 'hourly') {
    return Math.round(hundredthsOfHour(item.duration) * rate / 100);
  }
  return Math.round(item.quantity * rate);
}

/**
 * Subtotal, tax and total of an invoice in cents.
 */
export function invoiceTotals(invoice: Invoice) {
  let subtotal = 0;
  for (const item of invoice.items) {
    subtotal += itemAmount(item, invoice);
  }
  const tax = Math.round(subtotal * invoice.tax_percent / 100);
  return { subtotal, tax, total: subtotal + tax };
}

/**
 * Formats cents as money the way the invoice prints it.
 *
 * @example "$540.00"
 */
export function formatMoney(cents: number, currency: string) {
  const formatter = new Intl.NumberFormat('en-US', { currency, style: 'currency' });
  return formatter.format(cents / 100);
}

/**
 * Formats cents for a text field, without the currency.
 *
 * @example "540.00"
 */
export function formatMoneyInput(cents: number) {
  return (cents / 100).toFixed(2);
}

/**
 * Reads money typed in a text field, with a dot or a comma before the cents. Returns null when the
 * text is not a number of that shape.
 */
export function parseMoney(text: string) {
  const trimmed = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const parts = trimmed.split('.');
  const cents = (parts[1] ?? '').padEnd(2, '0');
  return parseInt(parts[0], 10) * 100 + parseInt(cents, 10);
}

/**
 * The signed-in person's payees, clients and invoices, for a backup file.
 */
export async function getBackupData() {
  const store = await readStore();
  const user = await getKey();
  return {
    clients: store.clients.filter(client => client.user_email === user),
    invoices: store.invoices.filter(invoice => invoice.user_email === user),
    payees: store.payees.filter(payee => payee.user_email === user)
  };
}

function isTime(value: any): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isAmount(value: any): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: any) {
  return typeof value === 'object'
    && value !== null
    && typeof value.id === 'string'
    && isTime(value.created_at)
    && isTime(value.updated_at);
}

function isParty(value: any): value is Party {
  return typeof value === 'object'
    && value !== null
    && typeof value.name === 'string'
    && typeof value.details === 'string';
}

function isPayee(value: any): value is Payee {
  return isRecord(value) && isParty(value);
}

function isClient(value: any): value is Client {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.details === 'string'
    && typeof value.currency === 'string'
    && isAmount(value.due_days)
    && isAmount(value.hourly_rate)
    && (value.payee_id === null || typeof value.payee_id === 'string');
}

function isItem(value: any): value is InvoiceItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!Array.isArray(value.entry_ids)) {
    return false;
  }
  if (value.parts !== undefined) {
    if (!Array.isArray(value.parts)) {
      return false;
    }
    for (const part of value.parts) {
      if (!isItem(part)) {
        return false;
      }
    }
  }
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && (value.kind === 'hourly' || value.kind === 'fixed')
    && isAmount(value.duration)
    && isAmount(value.quantity)
    && (value.rate === null || isAmount(value.rate));
}

function isInvoice(value: any): value is Invoice {
  if (!isRecord(value)) {
    return false;
  }
  if (!Array.isArray(value.items)) {
    return false;
  }
  for (const item of value.items) {
    if (!isItem(item)) {
      return false;
    }
  }
  return isParty(value.client)
    && isParty(value.payee)
    && (value.client_id === null || typeof value.client_id === 'string')
    && (value.payee_id === null || typeof value.payee_id === 'string')
    && typeof value.currency === 'string'
    && typeof value.date === 'string'
    && typeof value.due_date === 'string'
    && isAmount(value.hourly_rate)
    && isAmount(value.number)
    && isAmount(value.tax_percent);
}

/**
 * Puts each valid item of a backup into the list for this person. A new one is added, and an
 * existing one is replaced only when the copy in the backup is newer.
 */
function mergeList<T extends { id: string; updated_at: number; user_email: string; }>(list: T[], values: unknown, guard: (value: any) => value is T, user: string) {
  if (!Array.isArray(values)) {
    return;
  }
  for (const value of values) {
    if (!guard(value)) {
      continue;
    }
    const restored: T = { ...structuredClone(value), user_email: user };
    let index = -1;
    for (let position = 0; position < list.length; position++) {
      if (list[position].id === restored.id && list[position].user_email === user) {
        index = position;
      }
    }
    if (index === -1) {
      list.push(restored);
    } else if (restored.updated_at > list[index].updated_at) {
      list[index] = restored;
    }
  }
}

/**
 * The lists a backup file may carry. Backups made before invoices existed have none of them.
 */
interface BackupLists {
  clients?: unknown;

  invoices?: unknown;

  payees?: unknown;
}

/**
 * Merges the payees, clients and invoices of a backup into the signed-in person's data.
 */
export function restore(backup: BackupLists) {
  return mutate(function merge(store, user) {
    mergeList(store.payees, backup.payees, isPayee, user);
    mergeList(store.clients, backup.clients, isClient, user);
    mergeList(store.invoices, backup.invoices, isInvoice, user);
  });
}

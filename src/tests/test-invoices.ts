import assert from 'node:assert';
import type { Invoice, InvoiceItem } from '../lib/invoices';
import {
  createInvoice,
  deletePayee,
  formatMoney,
  getClients,
  getInvoices,
  getPayees,
  invoiceTotals,
  itemAmount,
  itemQuantity,
  mergeItems,
  nextNumber,
  parseMoney,
  saveClient,
  savePayee,
  splitItem,
  updateInvoice
} from '../lib/invoices';
import { createBackup, getEntries, pauseTask, restoreBackup, setPublicDuration, startTask } from '../lib/storage';
import { enqueue, reset, state } from './chrome-mock';

const hour = 3600000;

function hourly(id: string, duration: number, rate: number | null) {
  const item: InvoiceItem = { duration, entry_ids: [id], id, kind: 'hourly', quantity: 1, rate, title: id };
  return item;
}

function sampleInvoice(items: InvoiceItem[], taxPercent: number) {
  const invoice: Invoice = {
    client: { details: '', name: 'Client' },
    client_id: null,
    created_at: 1,
    currency: 'USD',
    date: '2026-11-10',
    due_date: '2026-11-17',
    hourly_rate: 5000,
    id: 'invoice',
    items,
    number: 1,
    payee: { details: '', name: 'Payee' },
    payee_id: null,
    period: null,
    tax_percent: taxPercent,
    updated_at: 1,
    user_email: 'me@example.com'
  };
  return invoice;
}

function testMoney() {
  assert(parseMoney('25') === 2500, 'expected whole money');
  assert(parseMoney('25,5') === 2550, 'expected a comma before the cents');
  assert(parseMoney('0.07') === 7, 'expected cents');
  assert(parseMoney('1.234') === null, 'expected more than two decimals to be rejected');
  assert(parseMoney('abc') === null, 'expected text to be rejected');
  assert(formatMoney(54000, 'USD') === '$540.00', 'expected dollars like the sample invoice');
}

function testAmounts() {
  // 20 minutes print as 0.33 hours, and the amount follows the printed hours.
  const third = hourly('third', 20 * 60000, null);
  const invoice = sampleInvoice([third, hourly('own-rate', 1.5 * hour, 10000)], 20);
  assert(itemQuantity(third) === 0.33, 'expected hours rounded to hundredths');
  assert(itemAmount(third, invoice) === 1650, 'expected 0.33 hours at $50');
  assert(itemAmount(invoice.items[1], invoice) === 15000, 'expected a line rate to win over the invoice rate');

  const fixed: InvoiceItem = { duration: 0, entry_ids: [], id: 'fixed', kind: 'fixed', quantity: 2, rate: 54000, title: 'video' };
  invoice.items.push(fixed);
  assert(itemQuantity(fixed) === 2, 'expected units for a fixed line');
  assert(itemAmount(fixed, invoice) === 108000, 'expected units times the price');

  const totals = invoiceTotals(invoice);
  assert(totals.subtotal === 124650, 'expected the subtotal of all lines');
  assert(totals.tax === 24930, 'expected 20% tax');
  assert(totals.total === 149580, 'expected subtotal plus tax');
}

function testMerge() {
  const items = [hourly('a', hour, 5000), hourly('b', hour, null), hourly('c', 30 * 60000, 5000)];
  const merged = mergeItems(items, ['a', 'c'], ' Design ');
  assert(merged !== null, 'expected two hourly lines to merge');
  assert(merged.length === 2, 'expected one line fewer');
  assert(merged[0].duration === 1.5 * hour, 'expected the time to add up');
  assert(merged[0].entry_ids.join() === 'a,c', 'expected both tasks to be remembered');
  assert(merged[0].rate === 5000, 'expected a shared rate to carry over');
  assert(merged[0].title === 'Design', 'expected the new title');
  assert(merged[1].id === 'b', 'expected other lines to stay in place');

  const mixed = mergeItems(items, ['a', 'b'], 'x');
  assert(mixed !== null, 'expected lines with different rates to merge');
  assert(mixed[0].rate === null, 'expected different rates to fall back to the invoice rate');

  const fixed: InvoiceItem = { duration: 0, entry_ids: [], id: 'f', kind: 'fixed', quantity: 1, rate: 100, title: 'f' };
  assert(mergeItems([...items, fixed], ['a', 'f'], 'x') === null, 'expected a fixed line not to merge');
  assert(mergeItems(items, ['a'], 'x') === null, 'expected one line not to merge');
}

function testSplit() {
  const items = [hourly('a', hour, 5000), hourly('b', hour, null), hourly('c', 30 * 60000, 5000)];
  const merged = mergeItems(items, ['a', 'c'], 'Design');
  assert(merged !== null, 'expected the lines to merge');
  // A change to the merged line is dropped when it is split.
  merged[0].duration = 5 * hour;
  const split = splitItem(merged, merged[0].id);
  assert(split !== null, 'expected a merged line to split');
  assert(split.map(item => item.id).join() === 'a,c,b', 'expected the lines back where the merged one was');
  assert(split[0].duration === hour, 'expected each line to get its own time back');
  assert(split[1].title === 'c', 'expected each line to get its own title back');

  // Merging a merged line again splits one step at a time.
  const twice = mergeItems(merged, [merged[0].id, 'b'], 'All');
  assert(twice !== null, 'expected a merged line to merge again');
  const once = splitItem(twice, twice[0].id);
  assert(once !== null, 'expected the outer merge to split');
  assert(once.length === 2, 'expected the inner merged line and b');
  assert(once[0].parts?.length === 2, 'expected the inner merged line to keep its parts');

  assert(splitItem(items, 'a') === null, 'expected a line that was not merged not to split');
}

function testNextNumber() {
  const first = sampleInvoice([], 0);
  first.payee_id = 'p1';
  first.number = 21;
  const other = sampleInvoice([], 0);
  other.payee_id = 'p2';
  other.number = 5;
  assert(nextNumber([first, other], 'p1') === 22, 'expected the number after the payee\'s last one');
  assert(nextNumber([first, other], 'p3') === 1, 'expected a new payee to start at 1');
}

async function testCreateLeavesEntriesAlone() {
  const task = await startTask('Задача', '', 'P1');
  await pauseTask(task.id);
  await setPublicDuration(task.id, 2 * hour);
  const before = JSON.stringify(state.storage.get('entries'));

  const payee = await savePayee(null, { details: 'IBAN\nXX00', name: 'Payee' });
  await saveClient(null, { currency: 'EUR', details: 'Somewhere', due_days: 10, hourly_rate: 4000, name: 'Client', payee_id: payee.id });
  const clients = await getClients();
  const entries = await getEntries();
  const tasks = [
    { duration: 2 * hour, entry_id: entries[0].id, title: 'One' },
    { duration: hour, entry_id: entries[0].id, title: 'Two' }
  ];
  const invoice = await createInvoice(tasks, null, new Date(2026, 10, 10));
  assert(invoice.number === 1, 'expected the first invoice to be number 1');
  assert(invoice.client_id === null, 'expected no client before the first invoice picks one');

  const merged = mergeItems(invoice.items, [invoice.items[0].id, invoice.items[1].id], 'Both');
  assert(merged !== null, 'expected the lines to merge');
  invoice.items = merged;
  invoice.client_id = clients[0].id;
  invoice.payee_id = payee.id;
  await updateInvoice(invoice);
  assert(JSON.stringify(state.storage.get('entries')) === before, 'expected the journal entries to stay exactly as they were');

  const next = await createInvoice([], null, new Date(2026, 11, 1));
  assert(next.client_id === clients[0].id, 'expected the next invoice to go to the last client');
  assert(next.currency === 'EUR', 'expected the client currency');
  assert(next.hourly_rate === 4000, 'expected the client rate');
  assert(next.due_date === '2026-12-11', 'expected the client payment terms');
  assert(next.number === 2, 'expected numbers to continue for the payee');
  assert(next.payee.name === 'Payee', 'expected a copy of the payee details');

  let refused = false;
  try {
    await deletePayee(payee.id);
  } catch (error) {
    refused = error instanceof Error;
  }
  assert(refused, 'expected a payee chosen by a client to stay');
}

async function testOtherPeopleAreHidden() {
  await savePayee(null, { details: '', name: 'Mine' });
  await createInvoice([], null, new Date());
  state.email = 'other@example.com';
  const payees = await getPayees();
  const invoices = await getInvoices();
  assert(payees.length === 0, 'expected another account not to see my payees');
  assert(invoices.length === 0, 'expected another account not to see my invoices');
}

async function testBackup() {
  await startTask('A', '', '');
  const payee = await savePayee(null, { details: 'IBAN', name: 'Payee' });
  await saveClient(null, { currency: 'USD', details: '', due_days: 7, hourly_rate: 100, name: 'Client', payee_id: payee.id });
  await createInvoice([{ duration: hour, entry_id: 'x', title: 'Line' }], null, new Date());
  const created = await createBackup();
  assert(created.version === 4, 'expected backup version 4');
  const backup: unknown = JSON.parse(JSON.stringify(created));

  state.storage.clear();
  state.email = 'new@example.com';
  await restoreBackup(backup);
  const payees = await getPayees();
  const clients = await getClients();
  const invoices = await getInvoices();
  assert(payees.length === 1, 'expected payees to come back');
  assert(clients.length === 1, 'expected clients to come back');
  assert(invoices.length === 1, 'expected invoices to come back');
  assert(invoices[0].items[0].title === 'Line', 'expected invoice lines to come back');
  assert(invoices[0].user_email === 'new@example.com', 'expected restored invoices to belong to the signed-in account');

  await restoreBackup(backup);
  const again = await getInvoices();
  assert(again.length === 1, 'expected a second restore to add nothing');

  await restoreBackup({ app: 'time-tracker', entries: [], invoices: ['garbage', { id: 'broken' }], version: 3 });
  const afterGarbage = await getInvoices();
  assert(afterGarbage.length === 1, 'expected broken invoices to be skipped');
}

async function main() {
  testMoney();
  testAmounts();
  testMerge();
  testSplit();
  testNextNumber();
  await testCreateLeavesEntriesAlone();
  reset();
  await testOtherPeopleAreHidden();
  reset();
  await testBackup();
}

enqueue('invoices', main);

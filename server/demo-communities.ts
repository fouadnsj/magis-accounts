// Makes three TEST databases for trying every level of the Jesuit communities' accounts:
//   homs-demo (community), damascus-demo (community), syria-demo (country econome).
// Invented people (no real names), password "test123" for everyone, a few entries in
// September 2026 (the quarter Jul–Sep closed and sent to the country) and October 2026
// (open, to play with). Closing by quarter (the default); no community bank; Jes-H2 has
// a bank account of his own.
// Never touches real data: it writes only into the folder given (--data=…).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Db, Row, SqlValue, Stmt } from '../src/db/db';
import { loadProfile } from '../src/auth';
import { runOp, type OpCtx } from '../src/ops';
import { createCommunity } from '../src/community/setup';
import { createCountry } from '../src/community/country';
import { loadAccounts, loadBooks, loadEntries } from '../src/community/repo';
import { balance } from '../src/community/domain';
import type { MonthFile, ReturnFile } from '../src/community/files';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
function open(file: string): Db {
  const sq = new DatabaseSync(file);
  sq.exec('PRAGMA foreign_keys = ON');
  return {
    async query<T = Row>(sql: string, params: SqlValue[] = []) { return sq.prepare(sql).all(...params) as T[]; },
    async batch(stmts: Stmt[]) {
      sq.exec('BEGIN');
      try { for (const s of stmts) sq.prepare(s.sql).run(...(s.params ?? [])); sq.exec('COMMIT'); } catch (e) { sq.exec('ROLLBACK'); throw e; }
    },
  };
}

const PW = 'test123';
const files = {} as OpCtx['files'];
const dataDir: string = process.argv.find((a) => a.startsWith('--data='))?.split('=')[1] ?? '';
if (!dataDir) throw new Error('--data=<folder> is required');

async function ctxs(db: Db) {
  const out: Record<string, OpCtx> = {};
  for (const p of await db.query<{ id: number; name: string }>('SELECT id, name FROM profile')) out[p.name] = { db, profile: (await loadProfile(db, p.id))!, who: p.name, install: 'office', files };
  return out;
}
const make = (slug: string) => {
  const dir = path.join(dataDir, 'dbs', slug);
  fs.mkdirSync(dir, { recursive: true });
  return open(path.join(dir, 'magis.db'));
};

async function main() {
  if (fs.existsSync(path.join(dataDir, 'dbs', 'homs-demo'))) { console.log('Demo databases already there.'); return; }
  const homs = make('homs-demo');
  const dam = make('damascus-demo');
  const syria = make('syria-demo');
  await createCommunity(homs, { community: 'Homs (demo)', country: 'Syria', localCurrency: 'SYP', mustChange: false, people: [
    { name: 'Sup-H', password: PW, roles: ['superior'] },
    { name: 'Eco-H', password: PW, roles: ['econome', 'minister'] },
    { name: 'Jes-H1', password: PW, roles: [] },
    { name: 'Jes-H2', password: PW, roles: [] },
  ] });
  await createCommunity(dam, { community: 'Damascus (demo)', country: 'Syria', localCurrency: 'SYP', mustChange: false, people: [
    { name: 'Sup-D', password: PW, roles: ['superior', 'econome'] },
    { name: 'Min-D', password: PW, roles: ['minister'] },
    { name: 'Jes-D1', password: PW, roles: [] },
  ] });
  await createCountry(syria, { country: 'Syria', localCurrency: 'SYP', mustChange: false, people: [{ name: 'Eco-Syria', password: PW }] });
  const H = await ctxs(homs), D = await ctxs(dam), S = await ctxs(syria);
  // Jes-H2 has a bank account of his own (the community has none: closing by quarter, the default)
  const jh2 = (await homs.query<{ id: number }>("SELECT id FROM profile WHERE name = 'Jes-H2'"))[0].id;
  await runOp(H['Sup-H'], 'cty.person.save', { id: jh2, name: 'Jes-H2', roles: [], hasBank: true });

  // ---- Homs, September 2026
  const hb = await loadBooks(homs);
  const id = (kind: string, name?: string) => hb.find((b) => b.cty_kind === kind && (!name || b.name === name))!.id;
  const code = async (db: Db, c: string) => (await loadAccounts(db)).find((a) => a.code === c)!.id;
  await runOp(H['Eco-H'], 'cty.book.opening', { bookId: id('cash'), opening: { LOC: 150000, USD: 600, EUR: 0 }, reason: 'demo start' });
  for (const [who, amount] of [['Jes-H1', 15000], ['Jes-H2', 12000]] as const) {
    const t = await runOp(H['Eco-H'], 'cty.entry.save', { entry: { book_id: id('cash'), to_book_id: id('personal', who), date: '2026-09-01', type: 'Transfer', cur: 'LOC', amount } });
    await runOp(H[who], 'cty.transfer.answer', { id: t, ok: true });
  }
  await runOp(H['Eco-H'], 'cty.entry.save', { entry: { book_id: id('cash'), to_book_id: id('house'), date: '2026-09-01', type: 'Transfer', cur: 'LOC', amount: 90000 } });
  await runOp(H['Eco-H'], 'cty.transfer.answer', { id: (await loadEntries(homs)).find((e) => e.to_book_id === id('house'))!.id, ok: true });
  const exp = async (who: OpCtx, book: number, date: string, c: string, amount: number, extra: Record<string, unknown> = {}) =>
    runOp(who, 'cty.entry.save', { entry: { book_id: book, date, type: 'Exp', account_id: await code(homs, c), cur: 'LOC', amount, ...extra } });
  await exp(H['Jes-H1'], id('personal', 'Jes-H1'), '2026-09-05', '61101', 1500);
  await exp(H['Jes-H1'], id('personal', 'Jes-H1'), '2026-09-12', '62051', 900);
  await exp(H['Jes-H1'], id('personal', 'Jes-H1'), '2026-09-20', '61402', 2200, { claim: 'health', note: 'medicine for the heart' });
  await exp(H['Jes-H2'], id('personal', 'Jes-H2'), '2026-09-08', '61201', 600, { note: 'two books' });
  await exp(H['Jes-H2'], id('personal', 'Jes-H2'), '2026-09-15', '62104', 450);
  await exp(H['Eco-H'], id('house'), '2026-09-03', '61101', 7000, { note: 'food for the community' });
  await exp(H['Eco-H'], id('house'), '2026-09-10', '63100', 3500);
  await exp(H['Eco-H'], id('house'), '2026-09-18', '62070', 70000, { note: 'cook, September (above $500: the Superior approves)' });
  // close September: every book, then the community
  let es = await loadEntries(homs);
  for (const b of await loadBooks(homs)) {
    if (!es.some((e) => e.book_id === b.id || e.to_book_id === b.id) && !b.opening_syp) continue;
    const who = b.cty_kind === 'personal' || b.cty_kind === 'personal_bank' ? H[b.keeper_name ?? b.name] : H['Eco-H'];
    // the cook's pay was above $500: the Superior approves it
    for (const e of es.filter((x) => x.book_id === b.id && x.approval_needed && !x.approved_at)) await runOp(H['Sup-H'], 'cty.entry.approve', { ids: [e.id] });
    await runOp(who, 'cty.month.close', { bookId: b.id, ym: '2026-09', counted: balance(es, b, '2026-09-30') }).catch((e) => { throw new Error(`${b.name}: ${e.message}`); });
  }
  await runOp(H['Sup-H'], 'cty.month.seen', { bookId: id('personal', 'Jes-H1'), ym: '2026-09' });
  await runOp(H['Eco-H'], 'cty.community.close', { ym: '2026-09' });

  // ---- Damascus, September 2026 (it hosted a Jesuit of Homs)
  const db_ = await loadBooks(dam);
  const did = (kind: string, name?: string) => db_.find((b) => b.cty_kind === kind && (!name || b.name === name))!.id;
  await runOp(D['Sup-D'], 'cty.book.opening', { bookId: did('cash'), opening: { LOC: 50000, USD: 300, EUR: 100 }, reason: 'demo start' });
  const t = await runOp(D['Sup-D'], 'cty.entry.save', { entry: { book_id: did('cash'), to_book_id: did('house'), date: '2026-09-01', type: 'Transfer', cur: 'LOC', amount: 20000 } });
  await runOp(D['Min-D'], 'cty.transfer.answer', { id: t, ok: true });
  await runOp(D['Min-D'], 'cty.entry.save', { entry: { book_id: did('house'), date: '2026-09-06', type: 'Exp', account_id: await code(dam, '61101'), cur: 'LOC', amount: 5000 } });
  await runOp(D['Sup-D'], 'cty.charge.save', { charge: { date: '2026-09-22', to_name: 'Homs (demo)', person: 'Jes-H2', cur: 'LOC', amount: 1200, note: '3 nights, retreat' } });
  es = await loadEntries(dam);
  for (const b of await loadBooks(dam)) {
    if (!es.some((e) => e.book_id === b.id || e.to_book_id === b.id) && !b.opening_syp) continue;
    await runOp(b.cty_kind === 'house' ? D['Min-D'] : D['Sup-D'], 'cty.month.close', { bookId: b.id, ym: '2026-09', counted: balance(es, b, '2026-09-30') });
  }
  await runOp(D['Sup-D'], 'cty.community.close', { ym: '2026-09' });

  // ---- the country econome receives both files; the return files go back
  for (const [ctx] of [[H['Eco-H']]] as const) await runOp(S['Eco-Syria'], 'country.import', { file: (await runOp(ctx, 'cty.month.file', { ym: '2026-09' })) as MonthFile });
  await runOp(S['Eco-Syria'], 'country.import', { file: (await runOp(D['Sup-D'], 'cty.month.file', { ym: '2026-09' })) as MonthFile });
  const sd = (await runOp(S['Eco-Syria'], 'country.data', undefined)) as { ctys: { id: number; name: string }[] };
  for (const c of sd.ctys) {
    const ret = (await runOp(S['Eco-Syria'], 'country.return.build', { ctyId: c.id })) as ReturnFile;
    await runOp(c.name.startsWith('Homs') ? H['Eco-H'] : D['Sup-D'], 'cty.return.import', { file: ret });
  }
  console.log('Demo databases made: Homs (demo), Damascus (demo), Syria (demo). Password for everyone: ' + PW);
}

main().catch((e) => { console.error(e); process.exit(1); });

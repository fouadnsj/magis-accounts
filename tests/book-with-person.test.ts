// Roles step 5 (25 November 2026; ROLES-AND-SIGNIN-ANALYSIS.md §9.3): the book is made with the person, in one window.
// "Keeps a cash book": the program makes the book with the person's name (not private, the Main book's city and account), links it,
// and gives back the temporary password once. Switching the person off switches their book off, never deletes it.
import { beforeAll, describe, expect, it } from 'vitest';
import { runOp, type AccessRow, type OpCtx, type SavedUser, type UserRow } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { booksSwitchedOffWith } from '../src/roles';
import type { Db } from '../src/db/db';
import { nodeDb } from './nodeDb';

const files = {} as OpCtx['files'];
type BookRow = { id: number; name: string; keeper_name: string | null; city_id: number | null; account_id: number | null; private: number; active: number; is_main: number };

describe('the book made with the person (roles step 5)', () => {
  let db: Db;
  let sup: OpCtx;
  let roles: AccessRow[];
  const idOf = async (name: string) => (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0].id;
  const ctxOf = async (name: string): Promise<OpCtx> => ({ db, profile: (await loadProfile(db, await idOf(name)))!, who: name, install: 'office', files });
  const role = (kind: string) => roles.find((r) => r.kind === kind)!;
  const book = async (name: string) => (await db.query<BookRow>('SELECT * FROM book WHERE name = ?', [name]))[0];
  const kept = async (name: string) => (await db.query<{ book_id: number }>('SELECT book_id FROM user_book WHERE profile_id = ?', [await idOf(name)])).map((r) => r.book_id);
  const save = (c: OpCtx, a: Record<string, unknown>) => runOp(c, 'user.save', { books: [], ...a }) as Promise<SavedUser>;

  beforeAll(async () => {
    db = nodeDb();
    await createOffice(db, { organisation: 'Book centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    sup = await ctxOf('Sup');
    roles = (await runOp(sup, 'access.list', {})) as AccessRow[];
    // the Accountant "adds book holders" when the Administrator ticks it on that role
    if (!role('accountant').perms.includes('users.holders')) await runOp(sup, 'access.save', { id: role('accountant').id, name: role('accountant').name, perms: [...role('accountant').perms, 'users.holders'] });
    roles = (await runOp(sup, 'access.list', {})) as AccessRow[];
    await save(sup, { name: 'Dina', roles: [role('director').id], pin: 'dina-pass-1' });
  });

  it('a new person with the role Book holder: the book is made with their name, linked, and the temporary password comes back once', async () => {
    const main = (await db.query<BookRow>('SELECT * FROM book WHERE is_main = 1'))[0];
    const r = await save(sup, { name: 'Karim', roles: [role('holder').id], makeBook: true });
    expect(r.book).toEqual({ id: expect.any(Number), name: 'Karim' });
    expect(r.password).toMatch(/^\d{6}$/);
    const b = await book('Karim');
    expect(b).toMatchObject({ keeper_name: 'Karim', private: 0, active: 1, is_main: 0, city_id: main.city_id, account_id: main.account_id });
    expect(await kept('Karim')).toEqual([b.id]);
    // the password works and must be changed at the first sign-in; he keeps his book and writes in it only
    const p = (await db.query<{ must_change: number }>('SELECT must_change FROM profile WHERE name = ?', ['Karim']))[0];
    expect(p.must_change).toBe(1);
    const karim = await ctxOf('Karim');
    expect(karim.profile.books).toEqual([b.id]);
    expect(karim.profile.perms).toContain('book.own');
    // a password typed by the giver is not given back
    const r2 = await save(sup, { name: 'Lina', roles: [role('holder').id], makeBook: true, pin: 'lina-pass-1' });
    expect(r2.password).toBe(null);
    expect(r2.book!.name).toBe('Lina');
    // the audit trail has the book
    expect((await db.query('SELECT 1 FROM audit_log WHERE tbl = ? AND row_id = ?', ['book', String(b.id)])).length).toBe(1);
  });

  it('without the tick the program makes no book; the roles must keep a cash book; the same name twice is refused (nothing is made)', async () => {
    const r = await save(sup, { name: 'Nour', roles: [role('holder').id], pin: 'nour-pass-1' });
    expect(r.book).toBe(null);
    expect(await book('Nour')).toBeUndefined();
    await expect(save(sup, { name: 'Omar', roles: [role('reception').id], makeBook: true, pin: 'omar-pass-1' })).rejects.toThrow(/do not keep a cash book/);
    expect((await db.query('SELECT 1 FROM profile WHERE name = ?', ['Omar'])).length).toBe(0);
    await expect(save(sup, { name: 'Karim', roles: [role('holder').id], makeBook: true, pin: 'again-pass-1' })).rejects.toThrow(/already/);
    expect((await db.query('SELECT 1 FROM book WHERE name = ?', ['Karim'])).length).toBe(1);
  });

  it('a Director gives Book holder and other roles in one step; the Administrator\'s and the Director\'s roles stay the Administrator\'s', async () => {
    const dina = await ctxOf('Dina');
    const r = await save(dina, { name: 'Rima', roles: [role('holder').id, role('reception').id, role('keeper').id], makeBook: true });
    expect(r.book!.name).toBe('Rima');
    const rima = await ctxOf('Rima');
    expect(rima.profile.books).toEqual([r.book!.id]);
    expect(rima.profile.perms).toContain('book.own');
    expect(rima.profile.perms).toContain('cal.outside');
    expect(rima.profile.perms).toContain('inventory.manage');
    expect((await book('Rima')).private).toBe(0);
    // a Director still cannot give Director, even with a book
    await expect(save(dina, { name: 'Sami', roles: [role('holder').id, role('director').id], makeBook: true })).rejects.toThrow(/Administrator only/);
    expect(await book('Sami')).toBeUndefined();
  });

  it('a person who is a book holder already but has no book: the book is offered later and made on request', async () => {
    const dina = await ctxOf('Dina');
    await save(dina, { name: 'Tarek', roles: [role('reception').id], pin: 'tarek-pass-1' });
    const tarek = await idOf('Tarek');
    // the Book holder role is added later (and the book with it)
    const r = await save(dina, { id: tarek, name: 'Tarek', roles: [role('reception').id, role('holder').id], makeBook: true });
    expect(r.book!.name).toBe('Tarek');
    expect(r.password).toBe(null); // a known person: no new password
    expect(await kept('Tarek')).toEqual([r.book!.id]);
    // the password he has stays (no pin sent)
    expect((await db.query<{ must_change: number }>('SELECT must_change FROM profile WHERE id = ?', [tarek]))[0].must_change).toBe(1);
    // saving him again without the tick changes nothing about his book
    await save(dina, { id: tarek, name: 'Tarek', roles: [role('reception').id, role('holder').id], books: [r.book!.id] });
    expect((await db.query('SELECT 1 FROM book WHERE name = ?', ['Tarek'])).length).toBe(1);
  });

  it('switching a person off switches their book off, never deletes it; a book somebody else keeps, the Main book and a private book stay', async () => {
    const dina = await ctxOf('Dina');
    const karimBook = (await book('Karim')).id;
    // a book two people keep
    const r = await save(sup, { name: 'Wael', roles: [role('holder').id], makeBook: true, pin: 'wael-pass-1' });
    await save(sup, { name: 'Yara', roles: [role('holder').id], books: [r.book!.id], pin: 'yara-pass-1' });
    // a private book and the Main book kept by a person who is switched off
    const main = (await db.query<{ id: number }>('SELECT id FROM book WHERE is_main = 1'))[0].id;
    const respo = (await db.query<{ id: number }>('SELECT id FROM book WHERE private = 1'))[0]?.id;
    await save(sup, { name: 'Zaid', roles: [role('accountant').id, role('holder').id], books: [main, ...(respo ? [respo] : [])], makeBook: true, pin: 'zaid-pass-1' });
    const zaidBook = (await book('Zaid')).id;

    const usersBefore = (await runOp(sup, 'users.list', {})) as UserRow[];
    const booksBefore = await db.query<BookRow & { parent_id: number | null }>('SELECT * FROM book');
    // the screen tells the same as the server
    expect(booksSwitchedOffWith(await idOf('Karim'), usersBefore, booksBefore).map((b) => b.name)).toEqual(['Karim']);
    expect(booksSwitchedOffWith(await idOf('Wael'), usersBefore, booksBefore)).toEqual([]);
    expect(booksSwitchedOffWith(await idOf('Zaid'), usersBefore, booksBefore).map((b) => b.name)).toEqual(['Zaid']);

    expect(await runOp(dina, 'user.deactivate', { id: await idOf('Karim') })).toEqual({ books: ['Karim'] });
    expect((await book('Karim')).active).toBe(0);
    expect(await kept('Karim')).toEqual([karimBook]); // the link and the book stay (nothing deleted)
    expect(await runOp(sup, 'user.deactivate', { id: await idOf('Wael') })).toEqual({ books: [] });
    expect((await book('Wael')).active).toBe(1); // Yara still keeps it
    expect(await runOp(sup, 'user.deactivate', { id: await idOf('Zaid') })).toEqual({ books: ['Zaid'] });
    expect((await book('Zaid')).active).toBe(0);
    expect(zaidBook).toBeGreaterThan(0);
    expect((await db.query<{ active: number }>('SELECT active FROM book WHERE id = ?', [main]))[0].active).toBe(1);
    if (respo) expect((await db.query<{ active: number }>('SELECT active FROM book WHERE id = ?', [respo]))[0].active).toBe(1);
    // now Yara is the last one: her turn
    expect(await runOp(sup, 'user.deactivate', { id: await idOf('Yara') })).toEqual({ books: ['Wael'] });
    expect((await book('Wael')).active).toBe(0);
  });

  it('the Accountant: the same small window, limited to Book holders; the book is made, never the Main book, never a private book, never another role', async () => {
    const com = await ctxOf('Com');
    const r = await save(com, { name: 'Hadi', roles: [role('holder').id], makeBook: true });
    expect(r.book!.name).toBe('Hadi');
    expect(r.password).toMatch(/^\d{6}$/);
    const b = await book('Hadi');
    expect(b.private).toBe(0);
    expect(b.is_main).toBe(0);
    expect(await kept('Hadi')).toEqual([b.id]);
    // never another role (with or without a book), never an exception
    await expect(save(com, { name: 'Nada', roles: [role('reception').id], makeBook: true })).rejects.toThrow(/book holder's role only/);
    await expect(save(com, { name: 'Nada', roles: [role('holder').id, role('reception').id], makeBook: true })).rejects.toThrow(/book holder's role only/);
    await expect(save(com, { name: 'Nada', roles: [role('holder').id], extra: ['cal.view'], makeBook: true })).rejects.toThrow(/book holder's role only/);
    expect(await book('Nada')).toBeUndefined();
    // never the Main book, never the Respo book, even with a book made
    const main = (await db.query<{ id: number }>('SELECT id FROM book WHERE is_main = 1'))[0].id;
    await expect(save(com, { name: 'Nada', roles: [role('holder').id], books: [main], makeBook: true })).rejects.toThrow(/Main book/);
    if (!(await db.query('SELECT 1 FROM book WHERE private = 1')).length)
      await db.batch([{ sql: "INSERT INTO book (name, keeper_name, city_id, account_id, is_main, private, sort) SELECT 'Private test', 'Sup', city_id, account_id, 0, 1, 98 FROM book WHERE id = ?", params: [main] }]);
    const respo = (await db.query<{ id: number }>('SELECT id FROM book WHERE private = 1'))[0].id;
    await expect(save(com, { name: 'Nada', roles: [role('holder').id], books: [respo], makeBook: true })).rejects.toThrow(/only in the role Administrator/);
    expect(await book('Nada')).toBeUndefined();
    // a person who is not a book holder is not his: not even to give them a book
    await expect(save(com, { id: await idOf('Dina'), name: 'Dina', roles: [role('holder').id], makeBook: true })).rejects.toThrow();
    await expect(save(com, { id: await idOf('Rima'), name: 'Rima', roles: [role('holder').id], makeBook: true })).rejects.toThrow();
    // he switches a book holder off: the book goes off with them
    expect(await runOp(com, 'user.deactivate', { id: await idOf('Hadi') })).toEqual({ books: ['Hadi'] });
    expect((await book('Hadi')).active).toBe(0);
    // the Respo book was never touched
    expect((await db.query<{ active: number }>('SELECT active FROM book WHERE id = ?', [respo]))[0].active).toBe(1);
  });

  it('existing people and books: nothing changes when nobody asks for a book (a person saved with their old books keeps them)', async () => {
    const main = (await db.query<{ id: number }>('SELECT id FROM book WHERE is_main = 1'))[0].id;
    const before = (await db.query('SELECT COUNT(*) AS n FROM book'))[0] as { n: number };
    await db.batch([{ sql: "INSERT INTO book (name, keeper_name, city_id, account_id, is_main, sort) SELECT 'Old petty', 'Old', city_id, account_id, 0, 97 FROM book WHERE id = ?", params: [main] }]);
    const old = (await book('Old petty')).id;
    const r = await save(sup, { name: 'Old keeper', roles: [role('holder').id], books: [old], pin: 'old-pass-1' });
    expect(r).toMatchObject({ book: null, password: null });
    expect((await db.query('SELECT COUNT(*) AS n FROM book'))[0]).toEqual({ n: before.n + 1 });
    expect(await kept('Old keeper')).toEqual([old]);
  });
});

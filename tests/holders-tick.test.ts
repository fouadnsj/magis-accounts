// "Adds book holders" (Fouad, 14 November 2026): the accountant may add a book holder, give him books and a password,
// switch him off — never the Superior's password, never another role, never the roles page.
import { describe, expect, it } from 'vitest';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { nodeDb } from './nodeDb';

const files = {} as OpCtx['files'];

describe('the tick "Adds book holders"', () => {
  it('book holders only, never the Superior nor a role', async () => {
    const db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    const ctxOf = async (name: string): Promise<OpCtx> => {
      const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
      return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
    };
    const sup = await ctxOf('Sup');
    const roles = (await runOp(sup, 'access.list', {})) as { id: number; name: string; perms: string[] }[];
    const accountant = roles.find((r) => r.name.includes('Accountant'))!;
    const holder = roles.find((r) => r.name.includes('Book holder'))!;
    const supRole = roles.find((r) => r.name.includes('Superior'))!;
    // without the tick: nothing
    let com = await ctxOf('Com');
    await expect(runOp(com, 'user.save', { name: 'Rami', access_id: holder.id, books: [], pin: 'rami-pass-1' })).rejects.toThrow();
    // the Superior gives the accountant the tick
    await runOp(sup, 'access.save', { id: accountant.id, name: accountant.name, perms: [...accountant.perms, 'users.holders'] });
    com = await ctxOf('Com');

    // he sees only the book holder's role
    expect(((await runOp(com, 'access.list', {})) as { id: number }[]).map((r) => r.id)).toEqual([holder.id]);
    // adds a book holder, changes his password, switches him off
    await runOp(com, 'user.save', { name: 'Rami', access_id: holder.id, books: [], pin: 'rami-pass-1' });
    const rami = (await db.query<{ id: number }>("SELECT id FROM profile WHERE name = 'Rami'"))[0].id;
    await runOp(com, 'profile.setPin', { id: rami, pin: 'rami-pass-2' });
    // never another role (for Rami, for a new user, or for himself)
    await expect(runOp(com, 'user.save', { id: rami, name: 'Rami', access_id: supRole.id, books: [] })).rejects.toThrow(/book holder/);
    await expect(runOp(com, 'user.save', { name: 'Boss2', access_id: supRole.id, books: [], pin: 'boss2-pass-1' })).rejects.toThrow(/book holder/);
    await expect(runOp(com, 'user.save', { id: com.profile.id, name: 'Com', access_id: supRole.id, books: [] })).rejects.toThrow();
    // never the Superior: not his password, not switched off
    await expect(runOp(com, 'profile.setPin', { id: sup.profile.id, pin: 'taken-over-1' })).rejects.toThrow();
    await expect(runOp(com, 'user.deactivate', { id: sup.profile.id })).rejects.toThrow(/book holders only/);
    // never the roles page
    await expect(runOp(com, 'access.save', { id: accountant.id, name: accountant.name, perms: [...accountant.perms, 'lists.donors'] })).rejects.toThrow();
    // his own password, yes
    await runOp(com, 'profile.setPin', { id: com.profile.id, pin: 'com-pass-2' });
    await runOp(com, 'user.deactivate', { id: rami });
  });
});

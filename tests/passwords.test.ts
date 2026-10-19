// MAGIS centres (Fouad, 19 October 2026): the Accountant resets a forgotten password, but only
// who manages users (the Superior) resets the password of someone who manages users.
import { describe, expect, it } from 'vitest';
import { runOp, type OpCtx } from '../src/ops';
import { loadProfile } from '../src/auth';
import { createOffice } from '../src/setup';
import { nodeDb } from './nodeDb';

describe('centre passwords', () => {
  it('the Accountant resets a holder, not the Superior; the Superior resets anyone', async () => {
    const db = nodeDb();
    await createOffice(db, { organisation: 'Test centre', supName: 'Sup', supPin: 'sup-pass-1', comName: 'Com', comPin: 'com-pass-1' });
    const files = {} as OpCtx['files'];
    const ctxOf = async (name: string): Promise<OpCtx> => {
      const p = (await db.query<{ id: number }>('SELECT id FROM profile WHERE name = ?', [name]))[0];
      return { db, profile: (await loadProfile(db, p.id))!, who: name, install: 'office', files };
    };
    const sup = await ctxOf('Sup');
    const com = await ctxOf('Com');
    expect(com.profile.perms).toContain('users.passwords');
    await runOp(sup, 'user.save', { name: 'Holder', access_id: 3, books: [], pin: 'holder-pass-1' });
    const holder = (await db.query<{ id: number }>("SELECT id FROM profile WHERE name = 'Holder'"))[0].id;
    // the Accountant sees the names, resets the holder's password (to be changed at the next sign-in)
    expect((await runOp(com, 'users.list', {}) as unknown[]).length).toBe(3);
    await runOp(com, 'profile.setPin', { id: holder, pin: 'new-pass-22' });
    expect((await db.query<{ must_change: number }>('SELECT must_change FROM profile WHERE id = ?', [holder]))[0].must_change).toBe(1);
    // …but not the Superior's
    await expect(runOp(com, 'profile.setPin', { id: sup.profile.id, pin: 'new-pass-33' })).rejects.toThrow(/manages users/);
    // the Superior resets anyone
    await runOp(sup, 'profile.setPin', { id: com.profile.id, pin: 'new-pass-44' });
    // a holder resets nobody else
    const h = await ctxOf('Holder');
    await expect(runOp(h, 'profile.setPin', { id: com.profile.id, pin: 'new-pass-55' })).rejects.toThrow();
  });
});

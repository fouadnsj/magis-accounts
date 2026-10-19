// Shared by the community tests: a community made from names, and the contexts of its accounts
// (the Jesuits by name; the offices as Superior, Econome, Minister, Admin).
import type { Db } from '../src/db/db';
import { loadProfile } from '../src/auth';
import type { OpCtx } from '../src/ops';
import { createCommunity, type CommunitySetup } from '../src/community/setup';
import type { Office } from '../src/community/people';

const files = {} as OpCtx['files'];
const KEY: Record<Office, string> = { superior: 'Superior', econome: 'Econome', minister: 'Minister', admin: 'Admin' };

/** Every Jesuit has the password test-pass-N; every office test-office-1. By default the first person holds every office. */
export async function makeCommunity(db: Db, name: string, persons: string[], held: Partial<Record<Office, string>> = {}, extra: Partial<CommunitySetup> = {}) {
  const who = (o: Office) => held[o] ?? persons[0];
  await createCommunity(db, {
    community: name, country: 'Syria', localCurrency: 'SYP',
    people: persons.map((p, i) => ({ name: p, password: `test-pass-${i + 1}` })),
    offices: {
      superior: { heldBy: who('superior'), password: 'test-office-1' },
      econome: { heldBy: who('econome'), password: 'test-office-2' },
      minister: { heldBy: who('minister'), password: 'test-office-3' },
      admin: { heldBy: who('admin'), password: 'test-office-4' },
    },
    ...extra,
  });
  return ctxMap(db);
}

export async function ctxMap(db: Db): Promise<Record<string, OpCtx>> {
  const out: Record<string, OpCtx> = {};
  for (const p of await db.query<{ id: number; name: string; cty_office: Office | null }>('SELECT id, name, cty_office FROM profile')) {
    out[p.cty_office ? KEY[p.cty_office] : p.name] = { db, profile: (await loadProfile(db, p.id))!, who: p.name, install: 'office', files };
  }
  return out;
}

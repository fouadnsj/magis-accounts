// A grant follows the money: promised → approved → transferred by the donor →
// in the bank → in hand. In hand, it is an income in the Superior's book; from
// there it is transferred to Main (confirmed by the Accountant) and spent on the
// accounts it is for. Each expense on those accounts uses the oldest grant that
// still has money for it (first in, first out), so a grant shows what is left.
import type { Computed, Trx } from './types';

export const GRANT_STEPS = ['promised', 'approved', 'transferred', 'bank', 'hand'] as const;
export type GrantStep = (typeof GRANT_STEPS)[number];

export interface GrantCard {
  id: string;
  donor_id: number;
  amount: number;
  currency: 'USD' | 'EUR';
  reference: string | null;
  note: string | null;
  status: GrantStep;
  promised_on: string | null;
  approved_on: string | null;
  transferred_on: string | null;
  bank_on: string | null;
  hand_on: string | null;
  /** the dollars really received in hand (a grant in euros is changed) */
  hand_usd: number | null;
  created_at?: string;
  created_by?: string | null;
}

export interface GrantPart {
  grant_id: string;
  /** null: the whole centre */
  account_id: number | null;
  /** in the grant's currency */
  amount: number;
}

export interface GrantFlow {
  /** dollars in hand (0 before "in hand") */
  inHand: number;
  /** transferred from the Superior's book to Main: confirmed, and waiting for confirmation */
  sent: number;
  sentWaiting: number;
  /** still with the Superior */
  withSup: number;
  /** spent on the accounts it is for */
  spent: number;
  left: number;
  /** per part: dollars and spent */
  parts: { account_id: number | null; usd: number; spent: number }[];
}

/** What each grant has become: in hand, sent to Main, spent on its accounts, left. */
export function grantFlows(cards: GrantCard[], parts: GrantPart[], rows: Trx[], comp: Map<string, Computed>): Map<string, GrantFlow> {
  const out = new Map<string, GrantFlow>();
  const inHand = cards.filter((g) => g.status === 'hand' && g.hand_usd != null && g.hand_on);
  // the parts in dollars, oldest grant first
  type Slot = { grant: GrantCard; account_id: number | null; usd: number; left: number; spent: number };
  const slots: Slot[] = [];
  for (const g of [...inHand].sort((a, b) => a.hand_on!.localeCompare(b.hand_on!) || a.id.localeCompare(b.id))) {
    const mine = parts.filter((p) => p.grant_id === g.id);
    const total = mine.reduce((s, p) => s + p.amount, 0) || g.amount;
    const rate = g.hand_usd! / g.amount; // EUR → USD as received
    const list = mine.length ? mine : [{ grant_id: g.id, account_id: null, amount: g.amount }];
    for (const p of list) {
      const usd = (p.amount / total) * g.amount * rate;
      slots.push({ grant: g, account_id: p.account_id, usd, left: usd, spent: 0 });
    }
  }
  // each expense, in date order, uses the oldest grant for its account (then one for the whole centre)
  const exps = rows.filter((r) => r.type === 'Exp' && r.date).sort((a, b) => a.date!.localeCompare(b.date!) || (a.n ?? 0) - (b.n ?? 0));
  for (const r of exps) {
    let need = comp.get(r.id)?.expUsdTot ?? 0;
    const eligible = (s: Slot) => s.left > 0.004 && r.date! >= s.grant.hand_on!;
    for (const pass of [(s: Slot) => s.account_id != null && s.account_id === r.account_id, (s: Slot) => s.account_id == null]) {
      for (const s of slots) {
        if (need <= 0.004) break;
        if (!pass(s) || !eligible(s)) continue;
        const take = Math.min(s.left, need);
        s.left -= take;
        s.spent += take;
        need -= take;
      }
    }
  }
  for (const g of cards) {
    const mine = slots.filter((s) => s.grant.id === g.id);
    const hand = g.status === 'hand' ? g.hand_usd ?? 0 : 0;
    const transfers = rows.filter((r) => r.type === 'Transfer' && r.grant_id === g.id);
    const usdOf = (r: Trx) => Math.abs(r.trf_usd) + Math.abs(r.trf_syp) / (comp.get(r.id)?.rate || 1);
    const sent = transfers.filter((r) => r.received_at).reduce((s, r) => s + usdOf(r), 0);
    const sentWaiting = transfers.filter((r) => !r.received_at && !r.disputed_at).reduce((s, r) => s + usdOf(r), 0);
    const spent = mine.reduce((s, x) => s + x.spent, 0);
    out.set(g.id, {
      inHand: hand, sent, sentWaiting, withSup: hand - sent - sentWaiting, spent, left: hand - spent,
      parts: mine.map((x) => ({ account_id: x.account_id, usd: x.usd, spent: x.spent })),
    });
  }
  return out;
}

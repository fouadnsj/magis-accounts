// A transfer as people think of it: from one book to another, once.
// In the register it is stored the workbook's way: rows only on keepers' books
// (Main's side is implicit), so
//   Main → Roula      = one row on Roula (+)
//   Roula → Main      = one row on Roula (−)
//   Roula → Nagham    = two rows linked by transfer_group (− on Roula, + on Nagham)
import type { Book, Trx } from './types';

export interface TransferInfo {
  key: string; // transfer_group, or the row id of a one-row transfer
  rowIds: string[];
  date: string | null;
  from: number | null; // book id (Main's id when Main gave)
  to: number | null;
  currency: 'SYP' | 'USD';
  amount: number; // positive
  explanation: string | null;
  createdBy: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  disputedAt: string | null;
  disputeNote: string | null;
}

export const transferKey = (r: Trx) => r.transfer_group ?? r.id;

export function buildTransfers(rows: Trx[], books: Book[]): TransferInfo[] {
  const mainId = books.find((b) => b.is_main)?.id ?? null;
  const groups = new Map<string, Trx[]>();
  for (const r of rows) {
    if (r.type !== 'Transfer') continue;
    const k = transferKey(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: TransferInfo[] = [];
  for (const [key, legs] of groups) {
    const first = legs[0];
    const v = (r: Trx) => r.trf_syp || r.trf_usd;
    const neg = legs.find((r) => v(r) < 0);
    const pos = legs.find((r) => v(r) > 0);
    out.push({
      key,
      rowIds: legs.map((r) => r.id),
      date: first.date,
      from: neg ? neg.book_id : mainId,
      to: pos ? pos.book_id : mainId,
      currency: first.trf_usd ? 'USD' : 'SYP',
      amount: Math.abs(v(first)),
      explanation: first.explanation,
      createdBy: first.created_by,
      receivedAt: first.received_at ?? null,
      receivedBy: first.received_by ?? null,
      disputedAt: first.disputed_at ?? null,
      disputeNote: first.dispute_note ?? null,
    });
  }
  return out.sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : -1));
}

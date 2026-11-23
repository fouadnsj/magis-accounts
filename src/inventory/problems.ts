// Problems reported (inventory step 3, baseline 1.1 sections 3 and 10): anyone of the centre writes what is wrong and where,
// with a photo if they can; it goes to the keeper's list; the keeper sets the state of the item (or "nothing wrong") and
// the person then sees "seen by the keeper" with the new state. Kept very simple. Pure rules here; the operations are in ops.ts.

export type ProblemResult = 'good' | 'repair' | 'broken' | 'nothing';
export const PROBLEM_RESULTS: ProblemResult[] = ['repair', 'broken', 'nothing', 'good'];

/** a problem as the screens get it (the photo itself comes by `inv.problem.photo`) */
export interface InvProblem {
  id: number;
  what: string;
  where_text: string | null;
  space_id: number | null;
  has_photo: boolean;
  reported_by: string;
  reported_at: string;
  status: 'new' | 'seen';
  item_id: number | null;
  item_code: string | null;
  item_name: string | null;
  result: ProblemResult | null;
  seen_by: string | null;
  seen_at: string | null;
  seen_note: string | null;
  /** the keeper's list also tells whether it is the viewer's own report */
  mine?: boolean;
}

/** a space a problem may be about (names only: whoever reports does not see the inventory) */
export interface ProblemSpace { id: number; name: string }

/** the report as written: both texts trimmed and kept short; null when nothing is said about what is wrong */
export function cleanReport(a: { what?: unknown; where?: unknown }): { what: string; where: string | null } | null {
  const what = String(a.what ?? '').trim().replace(/\s+/g, ' ').slice(0, 600);
  if (!what) return null;
  const where = String(a.where ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
  return { what, where: where || null };
}

/** The space a typed "where" is, when it is exactly the name of one (so the keeper can go to it); null otherwise. */
export function spaceOfWhere(where: string | null | undefined, spaces: ProblemSpace[]): number | null {
  const w = (where ?? '').trim().toLowerCase();
  if (!w) return null;
  const found = spaces.filter((s) => s.name.trim().toLowerCase() === w);
  return found.length === 1 ? found[0].id : null;
}

/** what the person who reported is told: waiting, or seen with the new state */
export function problemSaid(p: Pick<InvProblem, 'status' | 'result'>): 'waiting' | ProblemResult | 'seen' {
  if (p.status !== 'seen') return 'waiting';
  return p.result ?? 'seen';
}

/** the keeper's list: those waiting first (oldest first), then the answered ones (newest first) */
export function keeperOrder<T extends Pick<InvProblem, 'status' | 'reported_at' | 'seen_at'>>(list: T[]): T[] {
  const waiting = list.filter((p) => p.status !== 'seen').sort((a, b) => a.reported_at.localeCompare(b.reported_at));
  const seen = list.filter((p) => p.status === 'seen').sort((a, b) => (b.seen_at ?? '').localeCompare(a.seen_at ?? ''));
  return [...waiting, ...seen];
}

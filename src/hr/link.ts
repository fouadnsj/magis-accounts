// Where a person's stipend goes in the accounts of their centre (Fouad, 30 October 2026), the same on the server and
// on the screens: the budget line (one of the lines of the centre's salary heading) and the account. Chosen on the
// person's card, or guessed: the line named like their position (Homs: "Reception") or like them (Aleppo: one line per
// person); the account of the centre when the person has none.
import type { HrListItem, HrPerson } from './hr';

export const lineLabel = (l: Pick<HrListItem, 'code' | 'name'>) => (l.code ? `${l.code} · ${l.name}` : l.name);

/** the centre's list item of a person */
export const centreItem = (lists: HrListItem[], p: { centre?: string | null }) => (p.centre ? lists.find((x) => x.kind === 'centre' && x.name === p.centre) ?? null : null);

/** the lines a person may be paid on: the lines of their centre's salary heading */
export function salaryLines(lists: HrListItem[], p: { centre?: string | null }): HrListItem[] {
  const c = centreItem(lists, p);
  if (!c) return [];
  return lists.filter((x) => x.kind === 'line' && x.source === c.source && (!c.salary_heading || x.heading === c.salary_heading));
}

/** the accounts of a person's centre */
export function centreAccounts(lists: HrListItem[], p: { centre?: string | null }): HrListItem[] {
  const c = centreItem(lists, p);
  return c ? lists.filter((x) => x.kind === 'account' && x.source === c.source) : [];
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();

/** the line for a person: theirs if chosen; else the line named like their position, or like their first name */
export function lineFor(lists: HrListItem[], p: Pick<HrPerson, 'centre' | 'budget_line' | 'role' | 'first_name' | 'first_name_ar' | 'name'>): { line: HrListItem | null; guessed: boolean } {
  const lines = salaryLines(lists, p);
  // the line chosen on the card counts only if it is a salary line of the person's own centre
  if (p.budget_line) {
    const own = lines.find((x) => lineLabel(x) === p.budget_line);
    if (own) return { line: own, guessed: false };
  }
  const role = norm(p.role);
  const byRole = role ? lines.find((l) => norm(l.name) === role) ?? lines.find((l) => norm(l.name).includes(role) || (role.length > 3 && role.includes(norm(l.name)))) : undefined;
  if (byRole) return { line: byRole, guessed: true };
  for (const n of [p.first_name, p.first_name_ar, p.name?.split(' ')[0]].map(norm).filter((x) => x.length > 2)) {
    const byName = lines.find((l) => norm(l.name).split(' ').includes(n));
    if (byName) return { line: byName, guessed: true };
  }
  return { line: null, guessed: false };
}

/** the account for a person: theirs, else their centre's usual account */
export function accountFor(lists: HrListItem[], p: { centre?: string | null; account?: string | null }): string | null {
  const own = p.account && centreAccounts(lists, p).some((a) => a.name === p.account) ? p.account : null;
  return own || centreItem(lists, p)?.account || null;
}

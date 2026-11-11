// Where a person's stipend goes in the accounts of their centre (Fouad, 30 October 2026), the same on the server and
// on the screens: the budget line (one of the lines of the centre's salary heading), chosen on the person's card or
// guessed (the line named like their position, Homs "Reception", or like them, Aleppo: one line per person); and the
// project of that line in the centre's budget (Fouad, 2026-11-01: a salary follows its line; none = not funded).
import type { HrListItem, HrPerson } from './hr';

export const lineLabel = (l: Pick<HrListItem, 'code' | 'name'>) => (l.code ? `${l.code} · ${l.name}` : l.name);

/** the centre's list item of a person */
export const centreItem = (lists: HrListItem[], p: { centre?: string | null }) => (p.centre ? lists.find((x) => x.kind === 'centre' && x.name === p.centre) ?? null : null);

/** the lines a person may be paid on: the lines of their centre's salary heading */
export function salaryLines(lists: HrListItem[], p: { centre?: string | null }): HrListItem[] {
  const c = centreItem(lists, p);
  if (!c) return [];
  // (a centre may keep salaries under several headings, e.g. "Implementation staff | Operational staff")
  const heads = (c.salary_heading ?? '').split('|').map((h) => h.trim()).filter(Boolean);
  return lists.filter((x) => x.kind === 'line' && x.source === c.source && (!heads.length || heads.includes(x.heading ?? '')));
}

/** every line of a person's centre budget: a tutor's sessions may be paid on any of them (Fouad, 31 October 2026: the
 *  workshops from the workshops' line, English from the academic sessions' line), chosen on their card */
export function centreLines(lists: HrListItem[], p: { centre?: string | null }): HrListItem[] {
  const c = centreItem(lists, p);
  return c ? lists.filter((x) => x.kind === 'line' && x.source === c.source) : [];
}

/** the lines a centre pays its tutors on (ticked in the Settings); none ticked yet: every line of the centre */
export function tutorLines(lists: HrListItem[], p: { centre?: string | null }): HrListItem[] {
  const all = centreLines(lists, p);
  const ticked = all.filter((x) => x.tutor);
  return ticked.length ? ticked : all;
}

/** the lines a person may be chosen on: a tutor, the tutor lines of the centre; staff, the salary lines */
export const linesFor = (lists: HrListItem[], p: { centre?: string | null; category?: string | null }) => (p.category === 'tutor' ? tutorLines(lists, p) : salaryLines(lists, p));

/** the accounts of a person's centre */
export function centreAccounts(lists: HrListItem[], p: { centre?: string | null }): HrListItem[] {
  const c = centreItem(lists, p);
  return c ? lists.filter((x) => x.kind === 'account' && x.source === c.source) : [];
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();

/** the line for a person: theirs if chosen; else the line named like their position, or like their first name */
export function lineFor(lists: HrListItem[], p: Pick<HrPerson, 'centre' | 'budget_line' | 'role' | 'first_name' | 'first_name_ar' | 'name'> & { category?: string | null }): { line: HrListItem | null; guessed: boolean } {
  const lines = linesFor(lists, p);
  // the line chosen on the card counts only if it is a line of the person's own centre: a salary line for staff; for a
  // tutor any line of the centre (one chosen before the tutor lines were ticked still counts)
  if (p.budget_line) {
    const own = (p.category === 'tutor' ? centreLines(lists, p) : lines).find((x) => lineLabel(x) === p.budget_line);
    if (own) return { line: own, guessed: false };
  }
  if (p.category === 'tutor') return { line: null, guessed: false };
  const role = norm(p.role);
  const words = (x: string) => x.split(' ').filter(Boolean);
  // the same name, else the shortest line holding every word of the position ("IT" → "IT person"), else the longest
  // line whose words are all in the position ("Workshop Coordinator" → "Coordinator", one line in the common list);
  // never an insurance line
  const usable = lines.filter((l) => !/insurance|تأمين/i.test(l.name));
  const byRole = role ? lines.find((l) => norm(l.name) === role)
    ?? usable.filter((l) => words(role).every((w) => words(norm(l.name)).includes(w))).sort((a, b) => words(norm(a.name)).length - words(norm(b.name)).length)[0]
    ?? usable.filter((l) => words(norm(l.name)).length > 0 && words(norm(l.name)).every((w) => words(role).includes(w))).sort((a, b) => words(norm(b.name)).length - words(norm(a.name)).length)[0] : undefined;
  // the same name under several headings (the list by activity, 2027: Reception in Art Workshops, Academic and Library):
  // no guess — the line is chosen on the person's card
  const twice = (l: HrListItem) => lines.filter((x) => norm(x.name) === norm(l.name)).length > 1;
  if (byRole) return twice(byRole) ? { line: null, guessed: false } : { line: byRole, guessed: true };
  for (const n of [p.first_name, p.first_name_ar, p.name?.split(' ')[0]].map(norm).filter((x) => x.length > 2)) {
    const byName = lines.find((l) => norm(l.name).split(' ').includes(n));
    if (byName) return twice(byName) ? { line: null, guessed: false } : { line: byName, guessed: true };
  }
  return { line: null, guessed: false };
}

/** the project for a person: the project of their budget line (null: not funded) */
export function accountFor(lists: HrListItem[], p: Parameters<typeof lineFor>[1]): string | null {
  return lineFor(lists, p).line?.account ?? null;
}

// The report of one grant across the centres (Fouad, 2026-11-07): what was planned for each part (a project in a
// centre), sent and accepted, the budget given to the project there and what it spent — then the same by activity
// (heading) and by line, the centres together. Centres on the same list share their lines (by identity), so a line
// adds up across them; a copy from another server counts like the others, with its date.

export interface GrantReportPartIn {
  centre: string;
  centre_name: string;
  project_name: string | null;
  /** a copy from another server: when it was brought */
  copy_at: string | null;
  planned: number;
  sent_usd: number;
  sent_syp: number;
  accepted_usd: number;
  accepted_syp: number;
  /** the project's lines in that centre: its budget and what it spent (USD) */
  lines: { key: string; heading: string; line: string; budget: number; spent: number }[];
}

export interface GrantReportRow { key: string; heading: string; line: string | null; budget: number; spent: number; byCentre: Record<string, number> }

export interface GrantReport {
  parts: (GrantReportPartIn & { budget: number; spent: number })[];
  total: { planned: number; sent_usd: number; sent_syp: number; accepted_usd: number; budget: number; spent: number };
  byHeading: GrantReportRow[];
  byLine: GrantReportRow[];
}

export function grantReport(parts: GrantReportPartIn[]): GrantReport {
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  const out = parts.map((p) => ({ ...p, budget: sum(p.lines, (l) => l.budget), spent: sum(p.lines, (l) => l.spent) }));
  const heads = new Map<string, GrantReportRow>();
  const lines = new Map<string, GrantReportRow>();
  for (const p of out) {
    for (const l of p.lines) {
      const h = heads.get(l.heading) ?? { key: l.heading, heading: l.heading, line: null, budget: 0, spent: 0, byCentre: {} };
      h.budget += l.budget;
      h.spent += l.spent;
      h.byCentre[p.centre_name] = (h.byCentre[p.centre_name] ?? 0) + l.spent;
      heads.set(l.heading, h);
      const x = lines.get(l.key) ?? { key: l.key, heading: l.heading, line: l.line, budget: 0, spent: 0, byCentre: {} };
      x.budget += l.budget;
      x.spent += l.spent;
      x.byCentre[p.centre_name] = (x.byCentre[p.centre_name] ?? 0) + l.spent;
      lines.set(l.key, x);
    }
  }
  return {
    parts: out,
    total: {
      planned: sum(out, (p) => p.planned), sent_usd: sum(out, (p) => p.sent_usd), sent_syp: sum(out, (p) => p.sent_syp),
      accepted_usd: sum(out, (p) => p.accepted_usd), budget: sum(out, (p) => p.budget), spent: sum(out, (p) => p.spent),
    },
    byHeading: [...heads.values()],
    byLine: [...lines.values()].sort((a, b) => a.heading.localeCompare(b.heading) || (a.line ?? '').localeCompare(b.line ?? '')),
  };
}

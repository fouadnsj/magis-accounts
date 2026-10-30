// The pay rules of the HR database (Fouad, 30 October 2026), in one place.
// The scale is by MONTHLY amount: a position (e.g. Reception) has a monthly stipend for each year, or a person has
// an amount of their own. The hourly cost is then CALCULATED from the weekly hours fixed for that person:
//   hourly = monthly x 12 / (weekly hours x 52)   (the true hourly rate; monthly / weekly hours is four times too big).
// The yearly cost is the monthly stipend x 13: the 13th payment is a bonus instead of social security.

export interface PaySettings { paymentsPerYear: number; roundTo: number; maxWeekly: number; /** SYP for 1 USD, to show a stipend agreed in pounds in dollars (0 = not known yet) */ rateSyp: number }
export const DEFAULT_PAY: PaySettings = { paymentsPerYear: 13, roundTo: 5, maxWeekly: 40, rateSyp: 0 };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Hours of work expected in an average month. */
export const monthlyHours = (weekly: number) => (weekly * 52) / 12;

/** (kept for reference) the monthly stipend an hourly rate would give for these weekly hours. */
export function monthlyFromRate(hourly: number, weekly: number, roundTo = 5): number {
  const raw = hourly * monthlyHours(weekly);
  return roundTo > 0 ? Math.round(raw / roundTo) * roundTo : r2(raw);
}

/** The base hourly rate of a monthly stipend. null when the weekly hours are not known. */
export function hourlyFromMonthly(monthly: number, weekly: number | null | undefined): number | null {
  return weekly && weekly > 0 ? r2((monthly * 12) / (weekly * 52)) : null;
}

/** Hourly rate including the 13th payment (the full yearly cost per hour). */
export function hourlyWithThirteenth(monthly: number, weekly: number | null | undefined, payments = 13): number | null {
  return weekly && weekly > 0 ? r2((monthly * payments) / (weekly * 52)) : null;
}

export const yearlyCost = (monthly: number, payments = 13) => monthly * payments;

// ---- what a person is paid on a date (shared by the server and the screens)
// The stipend is fixed by the agreement at its beginning (a pay line made by the agreement), and can change from a date
// in the middle of the year (a pay line of its own). The latest line that has begun is the one paid. A position's
// reference amount is only a suggestion when an agreement is made; it is used for a line that has no amount of its own.
export interface ScaleGrade { id: number; name: string; monthly_usd: number | null }
export interface ScalePay { id: number; person_id: number; valid_from: string; grade_id: number | null; weekly_hours: number | null; monthly_usd: number | null; monthly_syp?: number | null; paper_id?: number | null }

/** What a person is paid on a date: from the latest pay line that has begun. */
export function payOn<G extends ScaleGrade, P extends ScalePay>(d: { grades: G[]; pays: P[]; settings?: { rateSyp: number } }, personId: number, today: string) {
  const p = d.pays.filter((x) => x.person_id === personId && x.valid_from <= today).sort((a, b) => b.valid_from.localeCompare(a.valid_from) || b.id - a.id)[0];
  if (!p) return null;
  const g = p.grade_id ? d.grades.find((x) => x.id === p.grade_id) ?? null : null;
  // agreed in pounds: the pounds are the amount; the dollars are an equivalent at the dollar rate (null while the rate is not known)
  const syp = p.monthly_syp ?? null;
  const rate = d.settings?.rateSyp ?? 0;
  const monthly = p.monthly_usd ?? (syp != null ? (rate > 0 ? Math.round((syp / rate) * 100) / 100 : null) : g?.monthly_usd ?? null);
  return { pay: p, grade: g, monthly, syp, needsRate: syp != null && !(rate > 0), weekly: p.weekly_hours, hourly: monthly != null ? hourlyFromMonthly(monthly, p.weekly_hours) : null };
}

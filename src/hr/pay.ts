// The pay rules of the HR database (Fouad, 30 October 2026), in one place.
// A grade has a BASE hourly rate (for the 12 months of the year). The monthly stipend of a person is
//   hourly rate x weekly hours x 52 / 12, rounded to the nearest 5 (the rounding is a setting).
// The yearly cost is the monthly stipend x 13: the 13th payment is a bonus instead of social security.
// "Hourly" of an agreed monthly amount is monthly x 12 / (weekly hours x 52): the true hourly rate
// (not the monthly amount divided by weekly hours, which is four times too big).

export interface PaySettings { paymentsPerYear: number; roundTo: number; maxWeekly: number }
export const DEFAULT_PAY: PaySettings = { paymentsPerYear: 13, roundTo: 5, maxWeekly: 40 };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Hours of work expected in an average month. */
export const monthlyHours = (weekly: number) => (weekly * 52) / 12;

/** The monthly stipend a grade gives for these weekly hours. */
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

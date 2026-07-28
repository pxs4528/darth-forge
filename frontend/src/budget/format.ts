// Money is stored as integer cents everywhere — in the database, over the wire,
// and in component state. It is only converted to a float for display.

export const centsToDollars = (cents: number): number => cents / 100;

/** "$1,234.56" */
export const money = (cents: number): string =>
  (cents < 0 ? "-" : "") +
  "$" +
  Math.abs(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** "$1,235" — for headline figures where cents are noise. */
export const moneyShort = (cents: number): string =>
  (cents < 0 ? "-" : "") + "$" + Math.round(Math.abs(cents) / 100).toLocaleString("en-US");

/** "$12.3k" — for chart axes. */
export const moneyAxis = (cents: number): string => {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? "-" : "";
  if (dollars >= 1000) return `${sign}$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(dollars)}`;
};

/**
 * Parses user input into cents. Accepts "12", "12.5", "$1,234.56", "1 234".
 * Returns null when the input isn't a usable number.
 */
export const parseCents = (input: string): number | null => {
  const cleaned = input.replace(/[$,\s]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
};

/** "2026-07" -> "July 2026" */
export const monthLabel = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

/** "2026-07" -> "Jul" */
export const monthShort = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
};

/** Shifts a "YYYY-MM" string by n months. */
export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const currentMonth = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

export const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
};

/** First day of a month, used when adding a transaction to a past month. */
export const firstOfMonth = (month: string): string => `${month}-01`;

export const percent = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : (numerator / denominator) * 100;

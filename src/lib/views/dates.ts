// `new Date("2026-05-17")` parses as UTC midnight, which lands in the previous
// calendar day for any timezone west of UTC. For YYYY-MM-DD inputs we build a
// local-time Date so the value stays on the day the user typed.
export function parseDate(val: unknown): Date | null {
  if (val == null || val === "") return null;
  const s = String(val);
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function compareValues(
  aVal: unknown,
  bVal: unknown,
  direction: "asc" | "desc"
): number {
  const aStr = aVal == null ? "" : String(aVal);
  const bStr = bVal == null ? "" : String(bVal);
  const aNum = Number(aStr);
  const bNum = Number(bStr);
  if (!isNaN(aNum) && !isNaN(bNum) && aStr !== "" && bStr !== "") {
    return direction === "asc" ? aNum - bNum : bNum - aNum;
  }
  return direction === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
}

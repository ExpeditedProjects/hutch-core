// Client-safe pure helper — no DB or revalidation imports.

export type SortableCollectionField = "name" | "role" | "recordCount" | "lastRecordAt";

type SortableRow = {
  name: string;
  role: string;
  recordCount: number;
  lastRecordAt: string | null;
};

export function sortCollections<T extends SortableRow>(
  collections: T[],
  sortBy: SortableCollectionField,
  direction: "asc" | "desc",
): T[] {
  const dirMul = direction === "asc" ? 1 : -1;
  return [...collections].sort((a, b) => {
    if (sortBy === "name") {
      return a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) * dirMul;
    }
    if (sortBy === "role") {
      return a.role.toLocaleLowerCase().localeCompare(b.role.toLocaleLowerCase()) * dirMul;
    }
    if (sortBy === "recordCount") {
      return (a.recordCount - b.recordCount) * dirMul;
    }
    // Default + lastRecordAt: nulls always last regardless of direction.
    const aNull = a.lastRecordAt == null;
    const bNull = b.lastRecordAt == null;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    return a.lastRecordAt!.localeCompare(b.lastRecordAt!) * dirMul;
  });
}

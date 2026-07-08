// Client-safe field type constants and helpers — no DB imports.

export type FieldType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "url"
  | "email"
  | "image_url"
  | "select"
  | "multiselect"
  | "json"
  | "file";

export const SELECTABLE_FIELD_TYPES = ["select", "multiselect"] as const;
export const MAX_OPTION_VALUE_LENGTH = 50;
export const MAX_OPTIONS_PER_FIELD = 50;

export function isSelectableField(field: { type: FieldType | string }): boolean {
  return field.type === "select" || field.type === "multiselect";
}

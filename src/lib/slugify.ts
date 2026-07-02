import { randomBytes } from "crypto";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function uniqueSlug(text: string): string {
  const base = slugify(text);
  const suffix = randomBytes(4).toString("hex");
  return `${base}-${suffix}`;
}

export function collectionUrl(slug: string): string {
  return `/c/${slug}`;
}

export function titleCase(text: string): string {
  return text
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

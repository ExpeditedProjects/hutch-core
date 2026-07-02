import { revalidatePath } from "next/cache";
import { emitCollectionChange, type CollectionEvent } from "@/lib/events";

// Wrapped so callers outside a request context (cron jobs, ad-hoc scripts) can
// still invoke service functions that revalidate as a side effect. revalidatePath
// throws "static generation store missing" when there's no active request.
function safeRevalidate(path: string, type?: "layout" | "page") {
  try {
    if (type) revalidatePath(path, type);
    else revalidatePath(path);
  } catch {
    // Not in a request context — nothing to invalidate.
  }
}

export function revalidateDashboard(slug?: string, changeType: CollectionEvent["type"] = "records") {
  // In headless Core these paths don't exist — the calls are no-ops — but we
  // still emit the change event so subscribers (SSE, cache invalidators layered
  // on top) can observe writes. Kept as one helper so services don't sprout
  // conditional edition checks.
  safeRevalidate('/dashboard');
  if (slug) {
    safeRevalidate(`/dashboard/collections/${slug}`);
    safeRevalidate(`/c/${slug}`, 'layout');
    emitCollectionChange(slug, changeType);
  }
}

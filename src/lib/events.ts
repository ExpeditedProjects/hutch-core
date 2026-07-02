import { EventEmitter } from "events";

export type CollectionEvent = {
  type: "records" | "schema" | "views";
  slug: string;
  timestamp: number;
};

const collectionEvents = new EventEmitter();
collectionEvents.setMaxListeners(0); // unlimited — bounded by MAX_CONNECTIONS_PER_SLUG instead

const connectionCounts = new Map<string, number>();
const MAX_CONNECTIONS_PER_SLUG = 20;

export function acquireConnection(slug: string): boolean {
  const count = connectionCounts.get(slug) ?? 0;
  if (count >= MAX_CONNECTIONS_PER_SLUG) return false;
  connectionCounts.set(slug, count + 1);
  return true;
}

export function releaseConnection(slug: string) {
  const count = connectionCounts.get(slug) ?? 0;
  if (count <= 1) {
    connectionCounts.delete(slug);
  } else {
    connectionCounts.set(slug, count - 1);
  }
}

export function emitCollectionChange(slug: string, type: CollectionEvent["type"] = "records") {
  const event: CollectionEvent = { type, slug, timestamp: Date.now() };
  collectionEvents.emit(`change:${slug}`, event);
}

export { collectionEvents };

import { createHash, timingSafeEqual } from "node:crypto";
import { getSingletonContext } from "./singleton";

export type AuthContext = { userId: string; orgId: string };

function extractBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = createHash("sha256").update(a).digest();
  const bBuf = createHash("sha256").update(b).digest();
  return timingSafeEqual(aBuf, bBuf);
}

export async function authenticate(req: Request): Promise<AuthContext | null> {
  const expected = process.env.HUTCH_API_KEY;

  if (!expected) {
    return getSingletonContext();
  }

  const token = extractBearer(req);
  if (!token) return null;

  if (!constantTimeEquals(token, expected)) return null;

  return getSingletonContext();
}

import { db } from "@/lib/db";
import { user, organizations, organizationMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { AuthContext } from "./seam";

const SINGLETON_USER_ID = "singleton-user";
const SINGLETON_USER_EMAIL = "local@hutch.internal";
const SINGLETON_USER_NAME = "Local";
const SINGLETON_ORG_ID = "singleton-org";
const SINGLETON_ORG_SLUG = "personal";
const SINGLETON_ORG_NAME = "Personal";

let cached: Promise<AuthContext> | null = null;

async function resolveContext(): Promise<AuthContext> {
  const existingUsers = await db
    .select()
    .from(user)
    .where(eq(user.email, SINGLETON_USER_EMAIL))
    .limit(1);

  const existingUser = existingUsers[0];

  if (existingUser?.id) {
    const existingOrgs = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, SINGLETON_ORG_SLUG))
      .limit(1);

    const existingOrg = existingOrgs[0];
    if (existingOrg?.id) {
      return { userId: existingUser.id, orgId: existingOrg.id };
    }
  }

  return db.transaction(async (tx) => {
    const userRows = await tx
      .insert(user)
      .values({ id: SINGLETON_USER_ID, email: SINGLETON_USER_EMAIL, name: SINGLETON_USER_NAME })
      .onConflictDoNothing({ target: user.email })
      .returning();

    const resolvedUserId = userRows[0]?.id ?? SINGLETON_USER_ID;

    const orgRows = await tx
      .insert(organizations)
      .values({ id: SINGLETON_ORG_ID, slug: SINGLETON_ORG_SLUG, name: SINGLETON_ORG_NAME, personal: true })
      .onConflictDoNothing({ target: organizations.slug })
      .returning();

    const resolvedOrgId = orgRows[0]?.id ?? SINGLETON_ORG_ID;

    await tx
      .insert(organizationMembers)
      .values({ organizationId: resolvedOrgId, userId: resolvedUserId, role: "admin" })
      .onConflictDoNothing();

    return { userId: resolvedUserId, orgId: resolvedOrgId };
  });
}

export async function getSingletonContext(): Promise<AuthContext> {
  if (!cached) {
    cached = resolveContext().catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

export interface BeforeCreateRecordParams {
  userId: string
  organizationId: string
  collectionName: string
  count: number
  bytes: number
}

// No-op in OSS. The hosted overlay (hutchdb-cloud) replaces this file with
// a Stripe-backed quota check that throws QuotaExceeded → HTTP 402.
export async function beforeCreateRecord(_params: BeforeCreateRecordParams): Promise<void> {
}

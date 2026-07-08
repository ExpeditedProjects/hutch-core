export interface BeforeCreateRecordParams {
  userId: string
  organizationId: string
  collectionName: string
  count: number
  bytes: number
}

export interface BeforeStoreFileParams {
  userId: string
  organizationId: string
  bytes: number
}

export interface ReleaseStorageParams {
  organizationId: string
  bytes: number
}

// No-op in OSS. The hosted overlay (hutchdb-cloud) replaces this file with
// a Stripe-backed quota check that throws QuotaExceeded → HTTP 402.
export async function beforeCreateRecord(_params: BeforeCreateRecordParams): Promise<void> {
}

// No-op in OSS. The hosted overlay replaces this with a storage-quota check
// that throws QuotaExceeded before a blob is written.
export async function beforeStoreFile(_params: BeforeStoreFileParams): Promise<void> {
}

// No-op in OSS. The hosted overlay replaces this to credit back storage when
// a blob is superseded or deleted.
export async function releaseStorage(_params: ReleaseStorageParams): Promise<void> {
}

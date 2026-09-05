import type { Context } from '@deepseek-ai/cordis'
import CredentialProvider, {
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'

export interface NativeSecretStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

const referenceKey = (ref: CredentialRef) => `ref:${ref}`
const recordKey = (key: CredentialKey) => `record:${key}`
const RECORD_INDEX = 'record-index'

/** DSH credential seam backed by native Keychain/Keystore callbacks. */
export class MobileCredentialProvider extends CredentialProvider {
  override readonly name = 'credentials-mobile'
  private recordMutation = Promise.resolve()

  constructor(ctx: Context, private readonly store: NativeSecretStore) {
    super(ctx)
  }

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = await this.store.get(referenceKey(ref))
    return value ? { value, source: 'native-secure-store' } : undefined
  }

  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    return { configured: (await this.resolve(ref)) !== undefined, source: 'native-secure-store', writable: true }
  }

  async set(ref: CredentialRef, value: string): Promise<void> {
    if (!value) throw new Error('credential value must not be empty')
    await this.store.set(referenceKey(ref), value)
    this.ctx.emit('credentials/reference-updated', ref)
  }

  async unset(ref: CredentialRef): Promise<void> {
    await this.store.delete(referenceKey(ref))
    this.ctx.emit('credentials/reference-updated', ref)
  }

  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    const encoded = await this.store.get(recordKey(key))
    return encoded ? JSON.parse(encoded) as CredentialRecord : undefined
  }

  async describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = await this.readRecord(key)
    return { configured: record !== undefined, ...(record ? { kind: record.kind } : {}), writable: true }
  }

  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    const encoded = await this.store.get(RECORD_INDEX)
    const keys = encoded ? JSON.parse(encoded) as CredentialKey[] : []
    const entries = await Promise.all(keys.map(async (key) => ({ key, record: await this.readRecord(key) })))
    return entries.flatMap(({ key, record }) => record ? [{ key, kind: record.kind }] : [])
  }

  async modifyRecord(key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined> {
    return this.serializeRecordMutation(async () => {
      const next = await mutate(await this.readRecord(key))
      if (next === undefined) return this.readRecord(key)
      await this.store.set(recordKey(key), JSON.stringify(next))
      const encoded = await this.store.get(RECORD_INDEX)
      const keys = new Set<CredentialKey>(encoded ? JSON.parse(encoded) as CredentialKey[] : [])
      keys.add(key)
      await this.store.set(RECORD_INDEX, JSON.stringify([...keys]))
      this.ctx.emit('credentials/record-updated', key)
      return structuredClone(next)
    })
  }

  async deleteRecord(key: CredentialKey): Promise<void> {
    await this.serializeRecordMutation(async () => {
      await this.store.delete(recordKey(key))
      const encoded = await this.store.get(RECORD_INDEX)
      const keys = new Set<CredentialKey>(encoded ? JSON.parse(encoded) as CredentialKey[] : [])
      keys.delete(key)
      await this.store.set(RECORD_INDEX, JSON.stringify([...keys]))
      this.ctx.emit('credentials/record-updated', key)
    })
  }

  private async serializeRecordMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.recordMutation
    let release!: () => void
    this.recordMutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }
}

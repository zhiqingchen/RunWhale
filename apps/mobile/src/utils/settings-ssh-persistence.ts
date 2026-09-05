export interface GeneratedSshCredential {
  publicKey: string
  fingerprint: string
  privateKeyOneTime: string
}

export interface SshCredentialPersistenceOperations {
  generate(): Promise<GeneratedSshCredential>
  readPrivateCredential(): Promise<string | null>
  writePrivateCredential(value: string): Promise<void>
  deletePrivateCredential(): Promise<void>
  readPublicMetadata(): Promise<string | null>
  writePublicMetadata(value: string): Promise<void>
  deletePublicMetadata(): Promise<void>
  restoreRuntimeCredential(value: string | null): Promise<void>
}

export async function generateAndPersistSshCredential(
  operations: SshCredentialPersistenceOperations,
): Promise<Pick<GeneratedSshCredential, 'publicKey' | 'fingerprint'>> {
  const [previousPrivateCredential, previousPublicMetadata] = await Promise.all([
    operations.readPrivateCredential(),
    operations.readPublicMetadata(),
  ])

  try {
    const generated = await operations.generate()
    await operations.writePrivateCredential(generated.privateKeyOneTime)
    await operations.writePublicMetadata(JSON.stringify({ publicKey: generated.publicKey, fingerprint: generated.fingerprint }))
    return { publicKey: generated.publicKey, fingerprint: generated.fingerprint }
  } catch (cause) {
    await Promise.allSettled([
      previousPrivateCredential === null
        ? operations.deletePrivateCredential()
        : operations.writePrivateCredential(previousPrivateCredential),
      previousPublicMetadata === null
        ? operations.deletePublicMetadata()
        : operations.writePublicMetadata(previousPublicMetadata),
      operations.restoreRuntimeCredential(previousPrivateCredential),
    ])
    throw cause
  }
}

export interface LatestOnlyWriter<T> {
  write(value: T): Promise<void>
}

export function createLatestOnlyWriter<T>(writeValue: (value: T) => Promise<void>): LatestOnlyWriter<T> {
  let pending: { value: T } | undefined
  let active: Promise<void> | undefined

  const drain = async (): Promise<void> => {
    while (pending) {
      const next = pending
      pending = undefined
      await writeValue(next.value)
    }
  }

  return {
    write(value) {
      pending = { value }
      active ??= drain().finally(() => { active = undefined })
      return active
    },
  }
}

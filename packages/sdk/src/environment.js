export function environment() {
  return {
    url: typeof location === 'undefined' ? undefined : location.href,
    locale: typeof navigator === 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : navigator.language,
  }
}

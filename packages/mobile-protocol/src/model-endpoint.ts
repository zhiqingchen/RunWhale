/** Model credentials and content may use HTTP only for an on-device development server. */
export function parseMobileModelEndpoint(value: string): URL {
  let endpoint: URL
  try { endpoint = new URL(value) }
  catch { throw new Error('Model endpoint must be a valid HTTPS URL.') }
  const loopback = endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1' || endpoint.hostname === '[::1]'
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) {
    throw new Error('Model endpoint must use HTTPS; HTTP is allowed only for localhost, 127.0.0.1, or [::1].')
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Model endpoint must not contain credentials, a query, or a fragment.')
  }
  return endpoint
}

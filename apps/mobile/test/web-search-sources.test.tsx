import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { WebSearchSources } from '../src/components/WebSearchSources'
const state = vi.hoisted(() => ({ openURL: vi.fn() }))
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Linking: { openURL: state.openURL } }))
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/theme/tokens', () => ({ useAppColors: () => ({ accent: 'blue', muted: 'gray', raised: 'white' }) }))
let tree: ReactTestRenderer
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
afterEach(async () => { await act(async () => tree?.unmount()); state.openURL.mockClear() })
it('renders durable sources as working links without exposing unsafe URLs', async () => {
  await act(async () => { tree = create(<WebSearchSources meta={{ sources: [{ title: 'Official news', url: 'https://example.com/news' }, { title: 'Unsafe', url: 'javascript:alert(1)' }] }} />) })
  const links = tree.root.findAllByProps({ accessibilityRole: 'link' })
  expect(links).toHaveLength(1)
  expect(links[0]!.props.accessibilityLabel).toBe('Official news')
  await act(async () => links[0]!.props.onPress())
  expect(state.openURL).toHaveBeenCalledWith('https://example.com/news')
})

it('renders Google suggestions in an isolated webview and opens only web links', async () => {
  await act(async () => { tree = create(<WebSearchSources meta={{ sources: [{ url: 'https://example.com' }], googleSearchSuggestions: '<div>Google Search</div>' }} />) })
  const widget = tree.root.findByType('WebView' as never)
  expect(widget.props.javaScriptEnabled).toBe(false)
  expect(widget.props.incognito).toBe(true)
  expect(widget.props.source.html).toContain("default-src 'none'")
  expect(widget.props.onShouldStartLoadWithRequest({ url: 'file:///private/data' })).toBe(false)
  expect(state.openURL).not.toHaveBeenCalled()
  expect(widget.props.onShouldStartLoadWithRequest({ url: 'https://www.google.com/search?q=test' })).toBe(false)
  expect(state.openURL).toHaveBeenCalledWith('https://www.google.com/search?q=test')
})

import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { useI18n } from '@/i18n'
import { useAppColors } from '@/theme/tokens'
import { googleSearchSuggestions, webSearchSources, webSourceUrl } from '@/utils/web-search'

export function WebSearchSources({ meta }: { meta: unknown }) {
  const sources = webSearchSources(meta)
  const suggestions = googleSearchSuggestions(meta)
  const colors = useAppColors()
  const { t } = useI18n()
  if (!sources.length) return null
  return <View style={{ gap: 6 }} testID="web-search-sources">
    {suggestions ? <WebView testID="google-search-suggestions" source={{ html: suggestions }}
      style={{ height: 120, backgroundColor: 'transparent' }} originWhitelist={['*']}
      javaScriptEnabled={false} domStorageEnabled={false} incognito sharedCookiesEnabled={false}
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never" setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === 'about:blank') return true
        const url = webSourceUrl(request.url)
        if (url) void Linking.openURL(url)
        return false
      }} /> : null}
    <Text style={{ fontSize: 12, color: colors.muted }}>{t('webSearchSources')}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {sources.map((source) => <Pressable key={source.url} accessibilityRole="link" accessibilityLabel={source.title}
        onPress={() => { void Linking.openURL(source.url) }}
        style={{ maxWidth: 230, padding: 10, borderRadius: 12, backgroundColor: colors.raised }}>
        <Text numberOfLines={2} style={{ fontSize: 13, color: colors.accent, fontWeight: '600' }}>{source.title}</Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{new URL(source.url).hostname}</Text>
      </Pressable>)}
    </ScrollView>
  </View>
}

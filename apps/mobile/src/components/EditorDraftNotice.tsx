import { useState } from 'react'
import { Text, View } from 'react-native'
import { Button } from 'heroui-native/button'
import { useProjects } from '@/state/projects'
import { useI18n } from '@/i18n'
import { useAppColors } from '@/theme/tokens'

export function EditorDraftNotice({ projectId, path }: { projectId: string; path: string }) {
  const { drafts, applyDraft, discardDraft } = useProjects()
  const { t } = useI18n()
  const colors = useAppColors()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const draft = drafts.find((item) => item.projectId === projectId && item.path === path)
  if (!draft) return null
  const resolve = async (apply: boolean) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try { await (apply ? applyDraft(projectId, path) : discardDraft(projectId, path)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <View style={{ padding: 12, gap: 8, backgroundColor: colors.panel }}>
    <Text style={{ color: colors.text }}>{t(draft.status === 'pending' ? 'savingFile' : 'fileDraftKept')}</Text>
    {draft.status !== 'pending' ? <>
      <Text style={{ color: colors.muted }}>{t('fileDraftDescription')}</Text>
      {error || draft.error ? <Text style={{ color: colors.text }}>{error ?? draft.error}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button size="sm" isDisabled={busy} onPress={() => { void resolve(true) }}><Button.Label>{t('applyFileDraft')}</Button.Label></Button>
        <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { void resolve(false) }}><Button.Label>{t('discardFileDraft')}</Button.Label></Button>
      </View>
    </> : null}
  </View>
}

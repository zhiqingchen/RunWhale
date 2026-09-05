import { useI18n } from '@/i18n'
import { useRuntime } from '@/state/runtime'
import { runExclusiveAction } from '@/utils/action-progress'
import { agentDraftStorageKey, appendAgentPrompt, createAgentDraftCoordinator, type AgentDraftCoordinator } from '@/utils/agent-draft'
import { agentImagePickerAvailable } from '@/utils/agent-feedback'
import type { AgentImageDraft, AgentImagePickerAsset } from '@/utils/agent-image'
import { validateAgentImageAsset } from '@/utils/agent-image'
import { filterProjectReferencePaths, projectReferenceLoadReducer } from '@/utils/agent-references'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import type { Dispatch } from 'react'
import { useCallback, useEffect, useReducer, useRef, useState, type SetStateAction } from 'react'
import { TextInput } from 'react-native'
import { QUICK_ACTION_DISMISS_DELAY_MS, type AgentAttachmentSource, type AgentPanelProps } from './agent-panel-types'

export function useAgentComposer({ projectId, sessionId, running, setError, promptInsertion, onPromptInserted }: Pick<AgentPanelProps, 'projectId' | 'promptInsertion' | 'onPromptInserted'> & { sessionId: string | undefined; running: boolean; setError: Dispatch<SetStateAction<string | undefined>> }) {
  const runtime = useRuntime()
  const { t } = useI18n()
  const [prompt, setPrompt] = useState('')
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string>()
  const lastPromptInsertion = useRef<string | undefined>(undefined)
  const [projectPaths, setProjectPaths] = useState<string[]>([])
  const [projectReferenceLoadState, transitionProjectReferenceLoad] = useReducer(projectReferenceLoadReducer, 'loading')
  const [projectReferenceError, setProjectReferenceError] = useState<string>()
  const projectReferenceLoadGuard = useRef(false)
  const [attachments, setAttachments] = useState<AgentImageDraft[]>([])
  const [pickingImages, setPickingImages] = useState(false)
  const imagePickerGuard = useRef(false)
  const composerInputRef = useRef<TextInput>(null)
  const draftKey = agentDraftStorageKey(projectId, sessionId)
  const draftCoordinatorRef = useRef<AgentDraftCoordinator | null>(null)
  if (!draftCoordinatorRef.current) {
    draftCoordinatorRef.current = createAgentDraftCoordinator({
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      removeItem: (key) => AsyncStorage.removeItem(key),
    })
  }
  const draftCoordinator = draftCoordinatorRef.current
  const updatePrompt = useCallback((value: SetStateAction<string>) => {
    draftCoordinator.markEdited(draftKey)
    setPrompt(value)
  }, [draftCoordinator, draftKey])
  const loadProjectReferences = useCallback(async () => {
    await runExclusiveAction(projectReferenceLoadGuard, async () => {
      setProjectPaths([])
      setProjectReferenceError(undefined)
      transitionProjectReferenceLoad('start')
      if (!runtime.info) {
        if (runtime.lastError) {
          setProjectReferenceError(runtime.lastError)
          transitionProjectReferenceLoad('fail')
        }
        return
      }
      try {
        const result = await runtime.request('project.files', { projectId })
        setProjectPaths(filterProjectReferencePaths(result.paths))
        transitionProjectReferenceLoad('succeed')
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setProjectReferenceError(message || t('runtimeStartupFailedBody'))
        transitionProjectReferenceLoad('fail')
      }
    })
  }, [projectId, runtime.info, runtime.lastError, runtime.request, t])
  useEffect(() => { void loadProjectReferences() }, [loadProjectReferences])
  useEffect(() => {
    setHydratedDraftKey(undefined)
    return draftCoordinator.beginHydration(draftKey, '', setPrompt, () => setHydratedDraftKey(draftKey))
  }, [draftCoordinator, draftKey])
  useEffect(() => {
    if (!promptInsertion || hydratedDraftKey !== draftKey || lastPromptInsertion.current === promptInsertion.id) return
    lastPromptInsertion.current = promptInsertion.id
    updatePrompt((current) => appendAgentPrompt(current, promptInsertion.text))
    onPromptInserted?.()
    setTimeout(() => composerInputRef.current?.focus(), QUICK_ACTION_DISMISS_DELAY_MS)
  }, [draftKey, hydratedDraftKey, onPromptInserted, promptInsertion, updatePrompt])
  useEffect(() => {
    draftCoordinator.persistEdited(draftKey, prompt)
  }, [draftCoordinator, draftKey, prompt])
  const pickImages = async (source: AgentAttachmentSource) => {
    if (!agentImagePickerAvailable(running, attachments.length)) return
    await runExclusiveAction(imagePickerGuard, async () => {
      setPickingImages(true)
      setError(undefined)
      try {
        const remaining = 4 - attachments.length
        const result = source === 'files'
          ? await DocumentPicker.getDocumentAsync({ type: 'image/*', multiple: true, copyToCacheDirectory: true })
          : source === 'photos'
            ? await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: false,
                allowsMultipleSelection: remaining > 1,
                selectionLimit: remaining,
                orderedSelection: true,
                quality: 1,
                preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
                shouldDownloadFromNetwork: true,
              })
            : await (async () => {
                const permission = await ImagePicker.requestCameraPermissionsAsync()
                if (!permission.granted) throw new Error(t('cameraPermissionDenied'))
                return ImagePicker.launchCameraAsync({
                  mediaTypes: ['images'],
                  allowsEditing: false,
                  cameraType: ImagePicker.CameraType.back,
                  quality: 0.85,
                })
              })()
        if (result.canceled) return
        const picked = (result.assets as AgentImagePickerAsset[]).slice(0, remaining).map((asset): AgentImageDraft => {
          const validation = validateAgentImageAsset(asset)
          if (!validation.ok) {
            if (validation.error === 'unsupported') throw new Error(t('unsupportedImage'))
            if (validation.error === 'too-large') throw new Error(t('imageTooLarge'))
            throw new Error(t('imageCacheUnavailable'))
          }
          return validation.draft
        })
        setAttachments((current) => [...current, ...picked])
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setPickingImages(false)
      }
    })
  }
  return { prompt, attachments, setAttachments, composerInputRef, updatePrompt, draftCoordinator, draftKey, projectPaths, projectReferenceLoadState, projectReferenceError, loadProjectReferences, pickingImages, pickImages }
}

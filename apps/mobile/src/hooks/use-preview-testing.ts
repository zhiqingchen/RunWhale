import { useEffect, useRef } from 'react'
import { findNodeHandle, type View } from 'react-native'
import type { WebView } from 'react-native-webview'
import { NodeHost } from '@runwhale/node-host'
import type { HostEvent, MobileHostMethod, MobileHostRequestMap, PreviewTestRequest, PreviewTestResult } from '@runwhale/mobile-protocol'

interface TestingOptions {
  projectId: string
  active?: { revision: number; bundleUrl: string; target: 'native' | 'web'; opened: boolean } | undefined
  webVisible: boolean
  events: readonly HostEvent[]
  request<M extends MobileHostMethod>(method: M, params: MobileHostRequestMap[M]['params']): Promise<MobileHostRequestMap[M]['result']>
  webView: React.RefObject<WebView | null>
  webCaptureView: React.RefObject<View | null>
}

export function usePreviewTesting(options: TestingOptions) {
  const current = useRef(options)
  current.current = options
  const handled = useRef(new Set<string>())
  const webReplies = useRef(new Map<string, { resolve(result: PreviewTestResult): void; timer: ReturnType<typeof setTimeout> }>())

  useEffect(() => () => {
    for (const reply of webReplies.current.values()) {
      clearTimeout(reply.timer)
      reply.resolve({ timestamp: Date.now(), error: 'Preview closed during inspection.' })
    }
    webReplies.current.clear()
  }, [])

  useEffect(() => {
    for (const event of options.events) {
      if (event.name !== 'preview.test.request') continue
      const probe = event.data as PreviewTestRequest
      if (probe.projectId !== options.projectId || probe.expiresAt <= Date.now() || handled.current.has(probe.id)) continue
      handled.current.add(probe.id)
      if (handled.current.size > 500) handled.current.delete(handled.current.values().next().value!)
      void (async () => {
        const request = current.current.request
        const identity = { id: probe.id, projectId: probe.projectId, revision: probe.revision }
        const claimed = await request('preview.test.claim', identity)
        if (!claimed.command) return
        let result: PreviewTestResult
        try {
          if (Date.now() >= probe.expiresAt) throw new Error('Preview test request expired before execution.')
          const selected = current.current
          const active = selected.active
          if (!active?.opened || active.revision !== probe.revision || selected.projectId !== probe.projectId) throw new Error('The requested Preview revision is not mounted. Run Preview and wait for startup.')
          if (active.target === 'native') {
            if (!NodeHost.testNativePreview) throw new Error('Update the RunWhale native host to enable Preview testing.')
            result = JSON.parse(await NodeHost.testNativePreview(probe.projectId, active.bundleUrl, JSON.stringify(claimed.command))) as PreviewTestResult
          } else {
            if (!selected.webVisible || !selected.webView.current) throw new Error('Open the project Web Preview before testing it.')
            if (claimed.command.kind === 'screenshot') {
              const tag = findNodeHandle(selected.webCaptureView.current)
              if (!tag || !NodeHost.captureWebPreview) throw new Error('Update the RunWhale native host to enable Web Preview screenshots.')
              result = JSON.parse(await NodeHost.captureWebPreview(tag)) as PreviewTestResult
            } else {
              const command = claimed.command
              result = await new Promise<PreviewTestResult>((resolve) => {
                const timer = setTimeout(() => {
                  webReplies.current.delete(probe.id)
                  resolve({ timestamp: Date.now(), error: 'The Web Preview did not respond to inspection.' })
                }, Math.max(1, probe.expiresAt - Date.now() - 500))
                webReplies.current.set(probe.id, { resolve, timer })
                selected.webView.current!.injectJavaScript(`if (window.__runwhalePreviewTest) window.__runwhalePreviewTest(${JSON.stringify(probe.id)}, ${JSON.stringify(command)}); else window.ReactNativeWebView.postMessage(JSON.stringify({type:'runwhale.preview.test',id:${JSON.stringify(probe.id)},result:{timestamp:Date.now(),error:'Preview testing bridge is unavailable. Rebuild and reopen Preview.'}})); true;`)
              })
            }
          }
          if (current.current.active?.bundleUrl !== active.bundleUrl) throw new Error('Preview changed during inspection. Inspect again.')
        } catch (error) {
          result = { timestamp: Date.now(), error: error instanceof Error ? error.message : String(error) }
        }
        await request('preview.test.complete', { ...identity, result })
      })().catch(() => { /* Host cancellation and transport recovery own request expiry. */ })
    }
  }, [options.events, options.projectId])

  return (data: string) => {
    if (data.length > 480_000) return
    try {
      const message = JSON.parse(data) as { type?: string; id?: string; result?: PreviewTestResult }
      if (message.type !== 'runwhale.preview.test' || !message.id || !message.result) return
      const pending = webReplies.current.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      webReplies.current.delete(message.id)
      pending.resolve(message.result)
    } catch { /* Other project WebView messages are not test responses. */ }
  }
}

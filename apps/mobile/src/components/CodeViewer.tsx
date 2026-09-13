'use dom'

import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

interface CodeViewerProps {
  value: string
  path: string
  dom?: import('expo/dom').DOMProps
}

export default function CodeViewer({ value, path }: CodeViewerProps) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const initialDocument = useRef({ path, value })
  const configuredPath = useRef(path)
  const compartments = useRef({
    language: new Compartment(),
    label: new Compartment(),
  })
  useEffect(() => {
    if (!host.current) return
    const initial = initialDocument.current
    const { language, label } = compartments.current
    document.documentElement.style.height = '100%'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.height = '100%'
    document.body.style.width = '100%'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    const reactRoot = host.current.parentElement
    if (reactRoot) {
      reactRoot.style.height = '100%'
      reactRoot.style.minHeight = '0'
      reactRoot.style.overflow = 'hidden'
    }
    const theme = new Compartment()
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          language.of(languageForPath(initial.path)),
          label.of(EditorView.contentAttributes.of({ 'aria-label': initial.path })),
          theme.of(editorAppearance(media.matches)),
        ],
      }),
    })
    editor.current = view
    const updateTheme = (event: MediaQueryListEvent) => view.dispatch({ effects: theme.reconfigure(editorAppearance(event.matches)) })
    media.addEventListener('change', updateTheme)
    return () => {
      media.removeEventListener('change', updateTheme)
      if (editor.current === view) editor.current = null
      view.destroy()
    }
  }, [])

  useEffect(() => {
    const view = editor.current
    if (!view) return
    const currentValue = view.state.doc.toString()
    const { language, label } = compartments.current
    const pathChanged = configuredPath.current !== path
    if (currentValue === value && !pathChanged) return
    view.dispatch({
      ...(currentValue === value ? {} : { changes: { from: 0, to: currentValue.length, insert: value } }),
      ...(pathChanged ? { effects: [
        language.reconfigure(languageForPath(path)),
        label.reconfigure(EditorView.contentAttributes.of({ 'aria-label': path })),
      ] } : {}),
    })
    configuredPath.current = path
  }, [path, value])

  return <div ref={host} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', background: '#0D131E' }} />
}

function languageForPath(path: string): Extension {
  const lowerPath = path.toLowerCase()
  if (/\.[cm]?[jt]sx?$/.test(lowerPath)) {
    return javascript({
      jsx: lowerPath.endsWith('.jsx') || lowerPath.endsWith('.tsx'),
      typescript: lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx') || lowerPath.endsWith('.mts') || lowerPath.endsWith('.cts'),
    })
  }
  if (/\.(?:json|jsonl|geojson)$/.test(lowerPath)) return json()
  if (/\.(?:css|scss|less)$/.test(lowerPath)) return css()
  if (/\.(?:html?|vue|svelte)$/.test(lowerPath)) return html()
  if (/\.(?:md|mdx|markdown)$/.test(lowerPath)) return markdown()
  return []
}

function editorAppearance(dark: boolean): Extension[] {
  return [editorTheme(dark), syntaxHighlighting(codeHighlightStyle(dark))]
}

function codeHighlightStyle(dark: boolean) {
  return HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier], color: dark ? '#FF8EBC' : '#9C2F64' },
    { tag: [tags.name, tags.variableName], color: dark ? '#E8F0FC' : '#192536' },
    { tag: [tags.definitionKeyword, tags.typeName, tags.className], color: dark ? '#7CCBFF' : '#16669B' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: dark ? '#AAB7FF' : '#4251A5' },
    { tag: [tags.string, tags.special(tags.string)], color: dark ? '#B7DD8B' : '#477A16' },
    { tag: [tags.number, tags.bool, tags.null], color: dark ? '#F2B879' : '#A64E12' },
    { tag: [tags.comment, tags.docComment], color: dark ? '#718198' : '#738094', fontStyle: 'italic' },
    { tag: [tags.operator, tags.punctuation], color: dark ? '#AFC1D8' : '#55657A' },
    { tag: [tags.tagName, tags.attributeName], color: dark ? '#71D7C1' : '#087765' },
    { tag: [tags.heading, tags.link], color: dark ? '#7CCBFF' : '#16669B', fontWeight: '600' },
  ])
}

function editorTheme(dark: boolean) {
  return EditorView.theme({
    '&': { height: '100%', minHeight: 0, maxHeight: '100%', overflow: 'hidden', backgroundColor: dark ? '#0D131E' : '#F7F9FC', color: dark ? '#E8F0FC' : '#192536', fontSize: '13px' },
    '.cm-scroller': { flex: '1 1 auto', height: 'auto', minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain', touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' },
    '.cm-content': { width: 'max-content', minWidth: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '12px 0', caretColor: dark ? '#52E3B6' : '#356CFF' },
    '.cm-gutters': { backgroundColor: dark ? '#0D131E' : '#EEF2F8', color: dark ? '#52627A' : '#8A98AA', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: dark ? '#131C2A' : '#E9EEF6' },
    '.cm-selectionBackground': { backgroundColor: `${dark ? '#254C66' : '#BFD2FF'} !important` },
  }, { dark })
}

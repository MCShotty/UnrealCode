import { useEffect, useRef } from 'react'
import { themeColors } from './theme-colors'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/editor/browser/coreCommands.js'
import 'monaco-editor/features/find/register.js'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js'
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js'
import 'monaco-editor/languages/definitions/javascript/register.js'
import 'monaco-editor/languages/definitions/typescript/register.js'
import 'monaco-editor/languages/definitions/python/register.js'
import 'monaco-editor/languages/definitions/go/register.js'
import 'monaco-editor/languages/definitions/cpp/register.js'
import 'monaco-editor/languages/definitions/css/register.js'
import 'monaco-editor/languages/definitions/html/register.js'
import 'monaco-editor/languages/definitions/markdown/register.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
const language = (path: string) => ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', go: 'go', cpp: 'cpp', h: 'cpp', css: 'css', html: 'html', md: 'markdown' }[path.split('.').at(-1)!] || 'plaintext')

export default function CodeEditor({ path, content, base, diff, onChange, onSave, onSelect, onSelection }: { path: string; content: string; base: string; diff: boolean; onChange(value: string): void; onSave(): void; onSelect(value: string, line: number): void; onSelection(value: string, line: number): void }) {
  const node = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const callbacks = useRef({ onChange, onSave, onSelect, onSelection })
  callbacks.current = { onChange, onSave, onSelect, onSelection }
  useEffect(() => {
    if (!node.current) return
    const model = monaco.editor.createModel(content, language(path))
    const original = diff ? monaco.editor.createModel(base, language(path)) : null
    const options = { automaticLayout: true, editContext: false, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, ariaLabel: `Edit ${path}`, accessibilitySupport: 'auto' as const, renderWhitespace: 'selection' as const }
    const outer = diff ? monaco.editor.createDiffEditor(node.current, { ...options, renderSideBySide: true, originalEditable: false }) : null
    const current = outer ? outer.getModifiedEditor() : monaco.editor.create(node.current, { ...options, model })
    if (outer) outer.setModel({ original: original!, modified: model })
    editor.current = current
    const theme = () => {
      const colors = themeColors(), light = document.documentElement.dataset.theme === 'light'
      monaco.editor.defineTheme('unrealcode', { base: light ? 'vs' : 'vs-dark', inherit: true, rules: [], colors: {
        'editor.background': colors.background, 'editor.foreground': colors.foreground,
        'editor.lineHighlightBackground': colors.hover, 'editor.selectionBackground': colors.selection,
        'editorCursor.foreground': colors.accent, 'editorWidget.background': colors.hover,
        'editorWidget.border': colors.line, 'focusBorder': colors.accent,
        'diffEditor.insertedTextBackground': colors.added, 'diffEditor.removedTextBackground': colors.removed,
        'scrollbarSlider.background': colors.scrollbar, 'scrollbarSlider.hoverBackground': colors.accent, 'scrollbarSlider.activeBackground': colors.accent
      } })
      monaco.editor.setTheme('unrealcode')
    }
    theme(); const observer = new MutationObserver(theme); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const listener = model.onDidChangeContent(() => callbacks.current.onChange(model.getValue(undefined, true)))
    current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacks.current.onSave())
    const selection = current.onDidChangeCursorSelection(event => callbacks.current.onSelection(event.selection.isEmpty() ? '' : model.getValueInRange(event.selection), event.selection.startLineNumber))
    current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.Enter, () => { const range = current.getSelection(); if (range && !range.isEmpty()) callbacks.current.onSelect(model.getValueInRange(range), range.startLineNumber) })
    return () => { observer.disconnect(); selection.dispose(); listener.dispose(); if (outer) outer.dispose(); else current.dispose(); model.dispose(); original?.dispose(); editor.current = null }
  }, [path, diff])
  useEffect(() => { const model = editor.current?.getModel(); if (model && model.getValue(undefined, true) !== content) model.setValue(content) }, [content])
  return <div className="code-editor" ref={node}/>
}

import type { EditableFile } from '../shared/api'
export type EditorTab = EditableFile & { saved: string; base: string }
export type EditorState = { tabs: EditorTab[]; active: string }
const states = new Map<string, EditorState>()
const listeners = new Set<() => void>()
export const editorSubscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function editorState(project: string): EditorState { if (!states.has(project)) states.set(project, { tabs: [], active: '' }); return states.get(project)! }
export function changeEditor(project: string, update: (state: EditorState) => EditorState): void { states.set(project, update(editorState(project))); for (const listener of listeners) listener() }
export const hasDirtyEditors = () => [...states.values()].some(state => state.tabs.some(tab => tab.content !== tab.saved))

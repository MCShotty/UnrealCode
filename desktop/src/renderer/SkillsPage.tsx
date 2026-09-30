import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Plus, Trash2, Zap } from 'lucide-react'
import type { SkillEntry } from '../shared/api'

type Draft = SkillEntry & { key: string; creating: boolean; saved: string; override?: boolean }
export function SkillsPage() {
  const [skills, setSkills] = useState<SkillEntry[]>([]), [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const generation = useRef(0), saving = useRef(false)
  const reload = useCallback(async () => {
    const token = ++generation.current
    try { const rows = await window.unreal.listSkills(); if (token === generation.current) setSkills(rows) }
    catch (reason) { if (token === generation.current) setError(String(reason)) }
  }, [])
  useEffect(() => { void reload(); return () => { generation.current++ } }, [reload])
  const canLeave = () => !draft || draft.content === draft.saved || confirm('Discard this unsaved skill draft?')
  const create = async () => {
    if (!canLeave()) return
    const token = ++generation.current
    try {
      const workspace = await window.unreal.activeWorkspace()
      if (token !== generation.current) return
      setDraft({ key: crypto.randomUUID(), name: '', content: '---\nname: \ndescription: Describe what this skill does.\n---\n\n# New skill\n\nWrite instructions here.\n', saved: '', source: 'project', description: '', revision: 'missing', workspace: workspace.path, creating: true })
      setError(''); setNotice('')
    } catch (reason) { if (token === generation.current) setError(String(reason)) }
  }
  const save = async () => {
    if (!draft || saving.current) return
    const snapshot = draft
    if (snapshot.creating && !snapshot.override && skills.some(item => item.name === snapshot.name && item.source === 'built-in')) { setError('Select the built-in skill and choose Copy to project to create an override.'); return }
    saving.current = true; setBusy(true); setError('')
    try {
      const saved = await window.unreal.saveSkill(snapshot.name, snapshot.content, snapshot.revision || 'missing', snapshot.workspace)
      setDraft(current => current?.key === snapshot.key ? { ...current, ...saved, content: current.content, saved: snapshot.content, creating: false } : current)
      setNotice('Saved. Start or resume a session to load the updated skill.'); await reload()
    } catch (reason) { setError(String(reason)) }
    finally { saving.current = false; setBusy(false) }
  }
  const remove = async () => {
    if (!draft || saving.current || !confirm(`Disable skill ${draft.name}? Its supporting files will remain.`)) return
    saving.current = true; setBusy(true)
    try { await window.unreal.deleteSkill(draft.name); setDraft(null); await reload() }
    catch (reason) { setError(String(reason)) }
    finally { saving.current = false; setBusy(false) }
  }
  return <div className="page-content skills-page">
    <div className="page-heading"><div><h2>Skills</h2><p>Built-in guidance works across projects. Project skills can extend it within the task’s permissions.</p></div><button className="primary-button" disabled={busy} onClick={() => void create()}><Plus size={16}/> New skill</button></div>
    <div className="skill-layout"><div className="skill-list">{skills.map(skill => <button className={`skill-row ${draft?.name === skill.name ? 'selected' : ''}`} key={skill.name} disabled={busy} onClick={() => { if (!canLeave()) return; generation.current++; setDraft({ ...skill, key: crypto.randomUUID(), creating: false, saved: skill.content }); setError(''); setNotice('') }}><Zap size={17}/><span><strong>{skill.name}</strong><small>{skill.source === 'built-in' ? 'Built in · ' : 'Project · '}{skill.description}</small></span></button>)}{!skills.length && <p className="muted-copy pad">No skills available.</p>}</div>
      <div className="skill-editor">{draft ? <>
        <div className="editor-toolbar"><strong>{draft.name || 'New skill'}/SKILL.md · {draft.source === 'built-in' ? 'Built in' : 'Project'}</strong><div>{draft.source === 'built-in' ? <button className="secondary-button" onClick={() => { setDraft({ ...draft, source: 'project', revision: 'missing', creating: true, override: true }); setNotice('Save to create a project override. The built-in original is preserved.') }}>Copy to project</button> : <>{!draft.creating && <button className="icon-button" disabled={busy} aria-label="Disable project skill" onClick={() => void remove()}><Trash2 size={16}/></button>}<button className="primary-button" disabled={busy || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(draft.name)} onClick={() => void save()}><Check size={15}/>{busy ? 'Saving…' : 'Save'}</button></>}</div></div>
        {draft.creating && <label className="skill-name-field">Skill folder name<input aria-label="Skill folder name" value={draft.name} readOnly={draft.override} disabled={busy} maxLength={64} onChange={event => { const name = event.target.value; setDraft({ ...draft, name, content: draft.content.replace(/^name:[^\r\n]*/m, `name: ${name}`) }) }}/><small>Lowercase letters, numbers, hyphens, and underscores. Existing skills are never replaced by creating a new one.</small></label>}
        <textarea spellCheck={false} value={draft.content} readOnly={draft.source === 'built-in'} onChange={event => setDraft({ ...draft, content: event.target.value })} aria-label="Skill content"/>
        {notice && <p className="success-text" role="status">{notice}</p>}
      </> : <div className="editor-empty">Select a skill or create one.</div>}{error && <p className="error-inline" role="alert">{error}</p>}</div>
    </div>
  </div>
}

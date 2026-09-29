import {ModelSelector} from './ModelSelector'
import {MemoryPage} from './MemoryPage'
import {ProgressIndicator} from './ProgressIndicator'
import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, CircleCheck, RotateCcw } from 'lucide-react'
import type { Provider, Settings } from '../shared/api'
import type { MemoryProfile, MemoryStatus } from '../shared/memory'

function initialProfile(settings: Settings): MemoryProfile {
  return { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, thinkingLevel: settings.thinkingLevel, requestLimit: 1000, tokenLimit: 1_000_000 }
}
function usesChatModel(profile: MemoryProfile, settings: Settings): boolean {
  return profile.provider === settings.provider && profile.model === settings.model &&
    profile.baseUrl === settings.baseUrl && profile.thinkingLevel === settings.thinkingLevel
}
const providers: [Provider, string][] = [
  ['openai-codex', 'Codex subscription'], ['openai', 'OpenAI API'], ['anthropic', 'Claude API'],
  ['openrouter', 'OpenRouter'], ['fireworks', 'Fireworks'], ['ollama', 'Ollama (local)'], ['openai-compatible', 'Local OpenAI compatible']
]

export function MemorySettingsPanel({ settings, projectPath, active }: {
  settings: Settings; projectPath?: string; active: boolean
}) {
  const [browse,setBrowse]=useState(false)
  const [profile, setProfile] = useState(() => initialProfile(settings))
  const [status, setStatus] = useState<MemoryStatus>()
  const [access, setAccess] = useState({ available: false, message: 'Checking provider access…' })
  const [keyEntered, setKeyEntered] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const edited = useRef(false)
  const keyInput = useRef<HTMLInputElement>(null)
  const clearKeyInput = () => { if (keyInput.current) keyInput.current.value = ''; setKeyEntered(false) }
  const mark = (patch: Partial<MemoryProfile>) => {
    edited.current = true; setNotice(''); setError('')
    setProfile(current => ({ ...current, ...patch }))
  }

  useEffect(() => {
    if (!active) return
    let live = true
    void window.unreal.memoryStatus(0).then(value => {
      if (!live) return
      setStatus(value)
      if (value.settings.profile && !edited.current) {
        setProfile(value.settings.profile)
      }
    }).catch(reason => { if (live) setError(String(reason)) })
    const dispose=window.unreal.onWorkflowChanged(()=>{void window.unreal.memoryStatus(0).then(value=>{if(live)setStatus(value)}).catch(()=>{})})
    return () => { live = false; dispose() }
  }, [active, projectPath])

  useEffect(() => {
    if (!active) return
    let live = true
    setAccess({ available: false, message: 'Checking provider access…' })
    if (profile.provider === 'openai-codex') void window.unreal.codexStatus().then(value => {
      if (live) setAccess({ available: value.available, message: value.message })
    }).catch(() => { if (live) setAccess({ available: false, message: 'Codex login status unavailable.' }) })
    else if (profile.provider === 'ollama') {
      setAccess({ available: true, message: 'Ollama runs locally; no API key is needed.' })
    } else void window.unreal.hasKey(profile.provider).then(available => {
      if (live) setAccess({ available, message: available ? 'Saved API key available.' : profile.provider === 'openai-compatible' ? 'No key saved. Local servers may not require one.' : 'No API key saved for this provider.' })
    }).catch(() => { if (live) setAccess({ available: false, message: 'Provider credential status unavailable.' }) })
    return () => { live = false }
  }, [active, profile.provider])

  const refresh = async () => {
    setStatus(await window.unreal.memoryStatus(0))
  }
  const savePendingKey = async () => {
    const value = keyInput.current?.value.trim()
    if (!value) return false
    await window.unreal.saveKey(profile.provider, value)
    clearKeyInput()
    setAccess({ available: true, message: 'Saved API key available.' })
    return true
  }
  const saveKey = async () => {
    setBusy(true); setError(''); setNotice('')
    try { await savePendingKey(); setNotice('API key saved for chat and memory. Test the model to confirm it works.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const saveAndVerify = async () => {
    if (!profile.model.trim()) { setError('Enter a model ID first.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const candidateKey=keyInput.current?.value.trim()||undefined
      if (!configured||candidateKey) await window.unreal.memorySwitchVerified(profile,candidateKey)
      else { await window.unreal.memoryVerify(); await window.unreal.memoryEnable(true) }
      await refresh()
      if(candidateKey){clearKeyInput();setAccess({available:true,message:'Saved API key available.'})}
      edited.current = false
      setNotice('Memory model verified. App-wide memory is on.')
    } catch (reason) {
      await refresh().catch(() => {})
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }
  const verifyAgain = async () => {
    setBusy(true); setError(''); setNotice('')
    try { await window.unreal.memoryVerify(); await refresh(); setNotice('Memory model verified.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const toggleProject = async (enabled: boolean) => {
    setBusy(true); setError(''); setNotice('')
    try {
      await window.unreal.memoryEnable(enabled)
      await refresh()
      setNotice(enabled ? 'App-wide memory is on.' : 'Automatic memory is off. Existing records stay available.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const retryService = async () => {
    setBusy(true); setError(''); setNotice('')
    try { await window.unreal.memoryRetry(); await refresh(); setNotice('Memory service is ready. Pending records can now be retained.') }
    catch (reason) { await refresh().catch(() => {}); setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const useChatProvider = () => {
    edited.current = true; setNotice(''); setError('')
    setModels([])
    clearKeyInput()
    setProfile(current => ({ ...current, provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, thinkingLevel: settings.thinkingLevel }))
  }
  const discover = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      await savePendingKey()
      const available = await window.unreal.discoverModels(profile.provider, profile.baseUrl)
      setModels(available)
      setNotice(available.length ? `Found ${available.length} model${available.length === 1 ? '' : 's'}. Choose one in Model ID.` : 'No models were reported by this server. Check its URL or enter a model ID manually.')
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const configured = !!status?.settings.profile && JSON.stringify(profile) === JSON.stringify(status.settings.profile)
  const verified = configured && !!status?.settings.verifiedProfile
  const projectEnabled = !!status?.settings.enabled && !!status.settings.globalConsent
  const projectPaused = !!status?.settings.profile && !!status.settings.enabled && !projectEnabled
  const changingSharedProfile = !!status?.settings.profile && !configured && status.settings.enabled
  const needsKey = ['openai', 'anthropic', 'openrouter', 'fireworks'].includes(profile.provider)
  const acceptsKey = needsKey || profile.provider === 'openai-compatible'
  const canTest = !!profile.model.trim() && (profile.provider !== 'openai-compatible' || !!profile.baseUrl.trim()) &&
    (!needsKey || access.available || keyEntered) && (profile.provider !== 'openai-codex' || access.available)

  if(browse)return <MemoryPage projectPath="" onSettings={()=>setBrowse(false)}/>
  return <div className="memory-settings-layout"><button className="secondary-button" onClick={()=>setBrowse(true)}>Browse app-wide memories</button>
    <div className="settings-grid memory-settings-grid">
      <section className="settings-section memory-provider-section">
        <div className="memory-provider-heading"><div><h2>Memory model</h2><p className="memory-intro">Choose the provider and model that remembers useful outcomes.</p></div><button className="secondary-button" type="button" disabled={busy || usesChatModel(profile, settings)} onClick={useChatProvider}><RotateCcw size={15}/> Use chat model</button></div>
        <p className="memory-model-source">{usesChatModel(profile, settings) ? 'Matches your chat model' : 'Separate memory model'}</p>
        <label>Provider<select aria-label="Memory model provider" value={profile.provider} disabled={busy} onChange={event => { setModels([]); clearKeyInput(); mark({ provider: event.target.value as Provider, model: '', baseUrl: '' }) }}>{providers.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <ModelSelector provider={profile.provider} model={profile.model} baseUrl={profile.baseUrl} disabled={busy} onChange={model=>mark({model})}/>
        <label>Reasoning level<select value={profile.thinkingLevel} disabled={busy} onChange={event => mark({ thinkingLevel: event.target.value as MemoryProfile['thinkingLevel'] })}>{['low', 'medium', 'high', 'xhigh', 'max'].map(level => <option key={level}>{level}</option>)}</select></label>
        {(profile.provider === 'ollama' || profile.provider === 'openai-compatible') && <><label>Local server URL<input aria-label="Memory model endpoint" value={profile.baseUrl} disabled={busy} onChange={event => mark({ baseUrl: event.target.value })} placeholder={profile.provider === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:1234/v1'}/></label><button className="secondary-button memory-discover" type="button" disabled={busy || profile.provider === 'openai-compatible' && !profile.baseUrl.trim()} onClick={() => void discover()}>Discover models</button></>}
        <details className="memory-advanced"><summary>Memory usage limits</summary><div className="memory-advanced-grid">
          <label>Maximum model requests<input aria-label="Memory model request limit" type="number" min={1} max={100000} value={profile.requestLimit} onChange={event => mark({ requestLimit: Number(event.target.value) })}/></label>
          <label>Maximum reported tokens<input aria-label="Memory model token limit" type="number" min={1} max={100000000} value={profile.tokenLimit} onChange={event => mark({ tokenLimit: Number(event.target.value) })}/></label>
        </div></details>
        {changingSharedProfile && <p className="memory-hint">This memory model is shared across projects. Changing it pauses processing until you verify the model and accept its destination. Existing knowledge is preserved.</p>}
        <div className="memory-action-row">{verified ? <><span className="memory-verified"><CircleCheck size={17}/> Model tested</span><button className="secondary-button" type="button" disabled={busy} onClick={() => void verifyAgain()}>Test again</button></> : <button className="primary-button" type="button" disabled={busy || !canTest} aria-busy={busy} onClick={() => void saveAndVerify()}><Check size={16}/>{busy ? 'Setting up memory…' : 'Save, test & turn on'}</button>}</div>
        {!canTest && !verified && <p className="memory-hint">{!profile.model.trim() ? 'Enter a model ID to continue.' : profile.provider === 'openai-compatible' && !profile.baseUrl.trim() ? 'Enter the local server URL to continue.' : 'Add a provider key or reconnect your Codex login to continue.'}</p>}
      </section>

      <div className="memory-settings-side">
      <section className="settings-section memory-credentials-section">
        <h2>Credentials</h2>
        <p className="memory-intro">Memory uses the same saved login or key as chat for this provider. Changing a key here also changes it for chat.</p>
        <p className="memory-credential-row" role="status">{access.message}</p>
        {acceptsKey && <><label>{profile.provider === 'openai-compatible' ? 'API key (optional)' : 'API key'}<input ref={keyInput} type="password" autoComplete="off" disabled={busy} onChange={event => setKeyEntered(!!event.target.value.trim())} placeholder={access.available ? 'Saved key available' : 'Enter provider key'}/></label>
          {keyEntered && <button className="secondary-button" type="button" disabled={busy} onClick={() => void saveKey()}>Save API key</button>}</>}
        {profile.provider === 'openai-codex' && <p className="memory-hint">Codex login is managed outside UnrealCode. Reopen this tab after reconnecting.</p>}
        {profile.provider === 'ollama' && <p className="memory-hint">Start Ollama and select a model. No credential setup is required.</p>}
      </section>
      <section className="settings-section memory-project-section">
        <h2>Automatic memory</h2><p>After completed turns, UnrealCode retains useful decisions and verified outcomes across trusted projects and conversations.</p>
        {<><div className="memory-project-name"><span>Scope</span><strong>All trusted projects and chats</strong></div>
          <label className="check-row memory-project-toggle"><input type="checkbox" checked={projectEnabled} disabled={busy || !verified && !projectEnabled} onChange={event => void toggleProject(event.target.checked)}/><span>Use app-wide memory</span></label>
          <p className="memory-state" role="status"><span className={'status-dot ' + (projectEnabled ? 'on' : '')}/>{projectEnabled ? 'On' : projectPaused ? verified ? 'Paused — turn it on to resume' : 'Paused — verify the model first' : verified ? 'Off' : 'Verify the model to enable memory'}</p>
          {projectEnabled && status?.state === 'unavailable' && <div className="memory-service-retry"><p className="memory-hint">{status.message || 'The local memory service is unavailable. Coding remains available.'}</p><button className="secondary-button" type="button" disabled={busy} aria-busy={busy} onClick={() => void retryService()}>{busy ? 'Retrying…' : 'Retry memory service'}</button></div>}
          {status?.migration&&<p className="memory-hint">Memory migration: {status.migration.state.replaceAll('-',' ')}. Prior data is backed up.</p>}<div className="memory-state"><ProgressIndicator state={busy||status?.analysing||status?.retaining?'running':status?.state==='ready'?'success':'idle'}/><span>{status?.analysing?'Summarizing activity':status?.retaining?'Retaining knowledge':busy?'Preparing memory':status?.pending?'Retention pending':'Memory ready when needed'}</span></div>{status && <p className="memory-hint">{status.pending} record{status.pending === 1 ? '' : 's'} awaiting retention. Browse and manage retained records in the Memory workspace.</p>}
        </>}
      </section>
      </div>
    </div>
    {error && <p className="error-inline memory-notice" role="alert">{error}</p>}
    {notice && <p className="success-text memory-notice" role="status"><CircleCheck size={16}/>{notice}</p>}
  </div>
}

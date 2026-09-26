import { useEffect,useState } from 'react'
import type { RepositoryHit } from '../shared/repository-context'
import type { SkillEntry } from '../shared/api'
export function ComposerContext({sessionId,prompt,onPrompt}:{sessionId?:string;prompt:string;onPrompt(value:string):void}) {
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[hits,setHits]=useState<RepositoryHit[]>([]),[attached,setAttached]=useState<string[]>([]),[skills,setSkills]=useState<SkillEntry[]>([]),[error,setError]=useState('')
 useEffect(()=>{let live=true;void window.unreal.contextView(sessionId||'draft').then(value=>{if(live)setAttached(value.selection.attached)}).catch(()=>{});return()=>{live=false}},[sessionId])
 useEffect(()=>{const match=/(?:^|\s)@([^\s@]*)$/.exec(prompt);if(match){setOpen(true);setQuery(match[1])}},[prompt])
 useEffect(()=>{if(!open)return;let live=true;void window.unreal.listSkills().then(value=>{if(live)setSkills(value)}).catch(reason=>setError(String(reason)));const timer=setTimeout(()=>{if(query.trim())void window.unreal.repositorySearch(query,true).then(value=>{if(live)setHits(value.hits)}).catch(reason=>{if(live)setError(String(reason))});else setHits([])},200);return()=>{live=false;clearTimeout(timer)}},[query,open])
 const update=async(paths:string[])=>{try{await window.unreal.updateContext(sessionId||'draft',{attached:paths});setAttached(paths);setError('')}catch(reason){setError(String(reason))}}
 return <div className="composer-context"><button className="text-button" aria-expanded={open} onClick={()=>setOpen(!open)}>@ Files & skills{attached.length?` · ${attached.length} attached`:''}</button>
 {open&&<div className="composer-context-menu"><input aria-label="Find project files" placeholder="Search @files" value={query} onChange={e=>setQuery(e.target.value)}/>{hits.map(hit=><button className="text-button" key={`${hit.path}:${hit.line}`} onClick={()=>{void update([...new Set([...attached,hit.path])]);onPrompt(prompt.replace(/(?:^|\s)@[^\s@]*$/,''));setOpen(false)}}>{hit.path}</button>)}{query&&!hits.length&&<small>No included filenames match.</small>}
 <label>Selected project skill<select aria-label="Select project skill" value="" onChange={e=>{if(e.target.value){onPrompt(`${prompt}\n\nUse the selected project skill: ${e.target.value}. Read its current instructions using SkillUse.`);setOpen(false)}}}><option value="">Choose a skill…</option>{skills.map(skill=><option key={skill.name} value={skill.name}>{skill.name} · {skill.description}</option>)}</select></label><small>Files use current contents on send. Skills remain in .harness/skills.</small></div>}
 {attached.length>0&&<div className="context-chips">{attached.map(path=><button className="text-button" title="Remove attachment" key={path} onClick={()=>void update(attached.filter(item=>item!==path))}>{path} ×</button>)}</div>}
 {error&&<p role="alert" className="error-inline">{error}</p>}</div>
}

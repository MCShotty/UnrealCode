import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionConfig, ConnectionView, ConnectionResource, ConnectionPrompt } from '../shared/connections'

const fresh = (): ConnectionConfig => ({ id:crypto.randomUUID(), name:'',kind:'remote',url:'',args:[],auth:'none',timeoutMs:60000 })
export function ConnectionsPage({ onAttach }: { onAttach(text:string):void }) {
  const [items,setItems]=useState<ConnectionView[]>([]),[config,setConfig]=useState(fresh),[args,setArgs]=useState('[]')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[credentials,setCredentials]=useState<Record<string,{token:string;env:string}>>({})
  const [resources,setResources]=useState<ConnectionResource[]>([]),[prompts,setPrompts]=useState<ConnectionPrompt[]>([]),[browse,setBrowse]=useState(''),[promptArgs,setPromptArgs]=useState('{}'),[preview,setPreview]=useState('')
  const [reference,setReference]=useState<{id:string;kind:'resources'|'prompts';revision:number;cursor?:string}>()
  const referenceRef=useRef(reference); referenceRef.current=reference
  const requests=useRef(0), refreshing=useRef(0), running=useRef(false), activeRequest=useRef('')
  const refresh=useCallback(async()=>{
    const request=++refreshing.current, rows=await window.unreal.connections()
    if(request!==refreshing.current)return
    setItems(rows)
    const owner=referenceRef.current, item=rows.find(row=>row.id===owner?.id)
    if(owner&&(!item||item.status!=='connected'||item.grant?.revision!==owner.revision||!item.grant?.[owner.kind])){requests.current++;setReference(undefined);setPreview('');setResources([]);setPrompts([])}
  },[])
  useEffect(()=>{let live=true; const update=()=>{if(live)void refresh().catch(reason=>setError(String(reason)))}; update();const dispose=window.unreal.onWorkflowChanged(update);return()=>{live=false;refreshing.current++;requests.current++;if(activeRequest.current)void window.unreal.connectionCancelReferences(activeRequest.current);dispose()}},[refresh])
  const run=async(work:()=>Promise<unknown>)=>{if(running.current)return;running.current=true;setBusy(true);setError('');try{await work();await refresh()}catch(reason){setError(String(reason))}finally{running.current=false;setBusy(false)}}
  const browsePage=async(id:string,kind:'resources'|'prompts',cursor?:string)=>{
    const request=++requests.current;activeRequest.current=id
    if(!cursor){setPreview('');setResources([]);setPrompts([]);setReference(undefined)}
    const page=kind==='resources'?await window.unreal.connectionResources(id,cursor):await window.unreal.connectionPrompts(id,cursor)
    if(request!==requests.current)return
    if(kind==='resources')setResources(current=>cursor?[...current,...page.items as ConnectionResource[]]:page.items as ConnectionResource[])
    else setPrompts(current=>cursor?[...current,...page.items as ConnectionPrompt[]]:page.items as ConnectionPrompt[])
    setBrowse(id);setReference({id,kind,revision:page.revision,cursor:page.nextCursor})
  }
  const readPreview=async(work:()=>Promise<string>)=>{const request=++requests.current;const text=await work();if(request===requests.current)setPreview(text)}
  const attach=async()=>{
    const owner=reference,request=requests.current
    const current=(await window.unreal.connections()).find(item=>item.id===owner?.id)
    if(!owner||request!==requests.current||!current||current.status!=='connected'||current.grant?.revision!==owner.revision||!current.grant?.[owner.kind]){setPreview('');throw Error('Reference access changed. Browse the connection again before attaching.')}
    onAttach(`<external_reference>\n${preview}\n</external_reference>`)
  }
  const selectedTools=(item:ConnectionView)=>item.tools.filter(tool=>tool.current&&item.grant?.tools.includes(tool.remoteName)&&item.grant?.toolRevisions?.[tool.remoteName]===tool.revision)
  const grant=(item:ConnectionView,patch:Partial<NonNullable<ConnectionView['grant']>>={})=>{
    const selected=selectedTools(item)
    return window.unreal.connectionGrant({connectionId:item.id,hostTrusted:item.kind==='host',tools:selected.map(tool=>tool.remoteName),toolRevisions:Object.fromEntries(selected.map(tool=>[tool.remoteName,tool.revision])),resources:item.grant?.resources||false,prompts:item.grant?.prompts||false,...patch})
  }
  return <div className="page-content connections-page">
    <div className="page-heading"><div><h2>MCP servers</h2><p>Choose project tools and where their servers run. External calls always show an approval.</p></div><button className="secondary-button" disabled={busy} onClick={()=>void run(refresh)}>Refresh</button></div>
    {error&&<p role="alert" className="error-inline">{error}</p>}
    <div className="connections-grid"><section className="settings-section"><h2>{items.some(item=>item.id===config.id)?'Edit connection':'Add connection'}</h2>
      <label>Name<input value={config.name} onChange={e=>setConfig({...config,name:e.target.value})}/></label>
      <label>Runs on<select value={config.kind} onChange={e=>setConfig({...config,kind:e.target.value as ConnectionConfig['kind'],auth:'none'})}><option value="remote">Remote · Streamable HTTP</option><option value="host">Windows · stdio</option><option value="container">Project container · stdio</option></select></label>
      {config.kind==='remote'?<label>MCP endpoint<input placeholder="https://server.example/mcp" value={config.url||''} onChange={e=>setConfig({...config,url:e.target.value})}/></label>:<><label>Executable<input placeholder={config.kind==='host'?'C:\\path\\server.exe':'python3'} value={config.command||''} onChange={e=>setConfig({...config,command:e.target.value})}/></label><label>Arguments (JSON array)<textarea value={args} onChange={e=>setArgs(e.target.value)} rows={3}/></label></>}
      {config.kind==='host'&&<p className="notice">Windows servers have your account’s host access. The project container does not restrict them.</p>}
      <label>Authentication<select value={config.auth} onChange={e=>setConfig({...config,auth:e.target.value as ConnectionConfig['auth']})}><option value="none">None / server environment</option>{config.kind==='remote'&&<><option value="bearer">Bearer token</option><option value="oauth">OAuth sign-in</option></>}</select></label>
      <label>Timeout (seconds)<input type="number" min={1} max={300} value={config.timeoutMs/1000} onChange={e=>setConfig({...config,timeoutMs:Number(e.target.value)*1000})}/></label>
      <div className="button-row"><button className="primary-button" disabled={busy||!config.name.trim()} onClick={()=>void run(async()=>{await window.unreal.connectionSave({...config,args:JSON.parse(args)});setConfig(fresh());setArgs('[]')})}>Save connection</button><button className="secondary-button" disabled={busy} onClick={()=>{setConfig(fresh());setArgs('[]')}}>New</button></div>
      <p className="muted-copy">Editing a saved configuration resets its grants and credentials. Put secrets in the connection credential fields below, never in arguments.</p>
    </section><section className="settings-section"><h2>Project connections</h2>
      {!items.length&&<p>No connections yet. Add a server, grant this project access, and connect.</p>}
      {items.map(item=><article className="connection-card" key={item.id}><h3>{item.name} <small>{item.kind==='host'?'Windows host':item.kind==='container'?'Project container':'Remote HTTP'} · {item.status}</small></h3><p>{item.message}</p>
        <div className="button-row"><button className="secondary-button" disabled={busy} onClick={()=>void run(()=>grant(item))}>{item.grant?'Review project grant':'Grant project access'}</button><button className="primary-button" disabled={busy||!item.grant} onClick={()=>void run(()=>window.unreal.connectionConnect(item.id,item.auth==='oauth'))}>Connect / reconnect{item.auth==='oauth'?' with sign-in':''}</button><button className="secondary-button" disabled={busy} onClick={()=>void run(()=>window.unreal.connectionDisconnect(item.id))}>Disconnect</button></div>
        <details><summary>Tools, resources and prompts</summary><input aria-label={`Search ${item.name} tools`} placeholder="Search available tools" value={query} onChange={e=>setQuery(e.target.value)}/>
          {item.tools.filter(tool=>tool.current&&`${tool.remoteName} ${tool.description}`.toLowerCase().includes(query.toLowerCase())).map(tool=><label className="connection-tool" key={tool.name}><input type="checkbox" disabled={busy||!item.grant} checked={item.grant?.tools.includes(tool.remoteName)&&item.grant?.toolRevisions?.[tool.remoteName]===tool.revision||false} onChange={e=>void run(()=>{const selected=selectedTools(item).filter(current=>current.remoteName!==tool.remoteName);if(e.target.checked)selected.push(tool);return grant(item,{tools:selected.map(current=>current.remoteName),toolRevisions:Object.fromEntries(selected.map(current=>[current.remoteName,current.revision]))})})}/><span><strong>{tool.remoteName}</strong><small>{tool.description}</small><code>{tool.name}</code></span></label>)}
          {!item.tools.length&&<p>Connect to discover tools.</p>}
          {item.grant?.tools.some(name=>!selectedTools(item).some(tool=>tool.remoteName===name))&&<p className="notice">A tool definition changed. Review and select its current version before use.</p>}
          <label className="connection-tool"><input type="checkbox" disabled={busy||!item.grant} checked={item.grant?.resources||false} onChange={e=>void run(()=>grant(item,{resources:e.target.checked}))}/> Allow selecting resources to attach</label>
          <label className="connection-tool"><input type="checkbox" disabled={busy||!item.grant} checked={item.grant?.prompts||false} onChange={e=>void run(()=>grant(item,{prompts:e.target.checked}))}/> Allow selecting prompt templates</label>
          <div className="button-row"><button disabled={busy||!item.grant?.resources||item.status!=='connected'} className="secondary-button" onClick={()=>void run(()=>browsePage(item.id,'resources'))}>Browse resources</button><button disabled={busy||!item.grant?.prompts||item.status!=='connected'} className="secondary-button" onClick={()=>void run(()=>browsePage(item.id,'prompts'))}>Browse prompts</button></div>
        </details>
        <details><summary>Credentials and configuration · {item.credentialState==='unavailable'?'unavailable':item.hasCredential?'saved':'none'}</summary>
          {item.credentialState==='unavailable'&&<p role="alert" className="error-inline">Saved credentials cannot be read. Check Windows credential encryption and the private vault before reconnecting.</p>}
          {item.kind==='remote'?<label>Bearer token<input type="password" autoComplete="off" value={credentials[item.id]?.token||''} onChange={e=>setCredentials({...credentials,[item.id]:{token:e.target.value,env:credentials[item.id]?.env||'{}'}})}/></label>:<label>Server-specific secret environment (JSON object)<textarea autoComplete="off" value={credentials[item.id]?.env||'{}'} onChange={e=>setCredentials({...credentials,[item.id]:{token:credentials[item.id]?.token||'',env:e.target.value}})} rows={3}/></label>}
          <div className="button-row"><button className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{await window.unreal.connectionCredential(item.id,credentials[item.id]?.token||'',JSON.parse(credentials[item.id]?.env||'{}'));setCredentials({...credentials,[item.id]:{token:'',env:'{}'}})})}>Save credentials</button><button className="secondary-button" disabled={busy} onClick={()=>{setConfig(item);setArgs(JSON.stringify(item.args));setCredentials({})}}>Edit</button><button className="secondary-button" disabled={busy} onClick={()=>void run(()=>window.unreal.connectionRemove(item.id))}>Remove connection</button><button className="secondary-button" disabled={busy} onClick={()=>void run(()=>window.unreal.connectionRevoke(item.id))}>Revoke project access</button></div>
        </details>
      </article>)}
    </section></div>
    {(resources.length>0||prompts.length>0||preview||reference)&&<section className="settings-section"><h2>Preview attachment</h2><p>Server content is reference material. Inspect it before adding it to your message.</p>
      {resources.map(resource=><button className="secondary-button" key={resource.uri} disabled={busy} onClick={()=>void run(()=>readPreview(async()=>`MCP resource ${resource.uri}\n${await window.unreal.connectionResource(browse,resource.uri)}`))}>{resource.name}</button>)}
      {prompts.length>0&&<label>Prompt arguments (JSON object)<textarea rows={3} value={promptArgs} onChange={e=>setPromptArgs(e.target.value)}/></label>}
      {prompts.map(prompt=><div key={prompt.name}><button className="secondary-button" disabled={busy} onClick={()=>void run(()=>readPreview(async()=>`MCP prompt ${prompt.name}\n${await window.unreal.connectionPrompt(browse,prompt.name,JSON.parse(promptArgs))}`))}>{prompt.name}</button><small>{prompt.arguments?.map(arg=>`${arg.name}${arg.required?' (required)':''}`).join(', ')}</small></div>)}
      {reference?.cursor&&<button className="secondary-button" disabled={busy} onClick={()=>void run(()=>browsePage(reference.id,reference.kind,reference.cursor))}>Load more</button>}
      {preview&&<><pre className="connection-preview">{preview}</pre><button className="primary-button" disabled={busy} onClick={()=>void run(attach)}>Attach to message</button></>}
    </section>}
  </div>
}

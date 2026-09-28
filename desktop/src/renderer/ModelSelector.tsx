import {useEffect,useId,useState} from 'react'
import type {Provider} from '../shared/api'
import type {ModelCatalog} from '../shared/model-catalog'
export function ModelSelector({provider,model,baseUrl='',onChange,disabled=false}:{provider:Provider;model:string;baseUrl?:string;onChange(value:string):void;disabled?:boolean}){
 const id=useId(),[catalog,setCatalog]=useState<ModelCatalog>(),[query,setQuery]=useState(''),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false)
 useEffect(()=>{let live=true;setLoading(true);setCatalog(undefined);void window.unreal.modelCatalog(provider,baseUrl,refresh>0).then(value=>{if(live)setCatalog(value)}).catch(()=>{if(live)setCatalog({provider,models:[],state:'unavailable',message:'Model discovery unavailable; enter a model ID manually.'})}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[provider,baseUrl,refresh])
 const all=catalog?.models||[],rows=all.filter(row=>`${row.id} ${row.name}`.toLowerCase().includes(query.toLowerCase())),selected=all.find(row=>row.id===model)
 return <div className="model-selector">
  <label htmlFor={`${id}-filter`}>Find a model<input id={`${id}-filter`} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search models" disabled={disabled}/></label>
  <label htmlFor={`${id}-models`}>Model<select id={`${id}-models`} disabled={disabled||loading||!rows.length} value={rows.some(row=>row.id===model)?model:''} onChange={e=>onChange(e.target.value)}><option value="" disabled>{loading?'Loading models…':'Choose a model'}</option>{rows.map(row=><option key={row.id} value={row.id} disabled={row.availability==='rejected'}>{row.name}{row.availability==='rejected'?' · Access denied':row.hidden?' · Hidden from default catalog':''}</option>)}</select></label>
  <p className="muted-copy" role="status">{selected?.reason||catalog?.message||'Checking model availability…'}{catalog?.state==='stale'?' Cached results.':''}</p>
  {selected?.description&&<small>{selected.description}</small>}
  {!!selected?.reasoning.length&&<small>Provider reasoning: {selected.reasoning.join(', ')}</small>}
  <div className="model-selector-footer"><button type="button" className="text-button" disabled={disabled||loading} onClick={()=>setRefresh(value=>value+1)}>Refresh models</button>{catalog?.checkedAt&&<small>Checked {new Date(catalog.checkedAt).toLocaleTimeString()}</small>}</div>
  <details open={all.length===0||!selected||undefined}><summary>Manual model ID · {selected?'catalog listed':'unverified'}</summary><label htmlFor={`${id}-manual`}>Model ID<input id={`${id}-manual`} disabled={disabled} value={model} onChange={e=>onChange(e.target.value)} placeholder="Provider model ID"/></label></details>
 </div>
}

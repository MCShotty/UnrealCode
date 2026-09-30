import type { FieldnoteSelection } from '../shared/fieldnotes'
const prefix='unrealcode-fieldnote-selection:'
const key=(project:string,session?:string)=>prefix+JSON.stringify([project,session||'new'])
const saved=new Map<string,FieldnoteSelection>()
export function fieldnoteSelection(project:string,session?:string):FieldnoteSelection {
 const id=key(project,session)
 if(!saved.has(id)){
  let value:FieldnoteSelection={include:[],exclude:[]}
  try{const found=JSON.parse(localStorage.getItem(id)||'null');if(found&&Array.isArray(found.include)&&Array.isArray(found.exclude)&&[...found.include,...found.exclude].every(x=>typeof x==='string'))value={include:found.include.slice(0,32),exclude:found.exclude.slice(0,100)}}catch{/* An unavailable preference cache does not block sending. */}
  saved.set(id,value)
 }
 return saved.get(id)!
}
export function saveFieldnoteSelection(project:string,session:string|undefined,value:FieldnoteSelection){const id=key(project,session);saved.set(id,value);try{localStorage.setItem(id,JSON.stringify(value))}catch{/* Selection remains in memory for this window. */}}
export function openFieldnote(id:string){window.dispatchEvent(new CustomEvent('unrealcode:fieldnote',{detail:{id}}))}

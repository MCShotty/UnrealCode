import type {ComputerAction,ComputerObservation,ComputerOwner} from '../shared/computer'

export function assertReviewedComputerDestination(owner:ComputerOwner,reviewed:string):void{
 if(typeof reviewed!=='string'||reviewed!==owner.destination)throw Error('The task model destination changed. Review computer access again before sharing a window.')
}

// A small positive allowlist. Labels from applications never authorize an action.
// Unknown controls, shortcuts and coordinate clicks always get exact-operation review.
export function routineComputerAction(action:ComputerAction,view:ComputerObservation):boolean {
 const element=view.elements.find(item=>item.id===action.elementId)
 if(action.kind==='scroll')return true
 if(action.kind==='key')return !action.modifiers?.length&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End','Tab','Escape'].includes(action.key||'')
 if(!element||!element.enabled||element.password)return false
 if(action.kind==='click')return ['TabItem','TreeItem','ListItem','ScrollBar'].includes(element.role)
 if(action.kind==='select')return ['ListItem','TabItem'].includes(element.role)
 return false
}
export function validComputerAction(value:unknown):ComputerAction {
 if(!value||typeof value!=='object'||Array.isArray(value)||Buffer.byteLength(JSON.stringify(value))>12000)throw Error('Provide one bounded computer action')
 const action=value as ComputerAction
 if(!['click','type','select','key','scroll','click-point'].includes(action.kind))throw Error('Unknown computer action')
 for(const key of ['elementId','text','value','key'] as const)if(action[key]!==undefined&&(typeof action[key]!=='string'||action[key]!.length>(key==='text'?4096:1024)||action[key]!.includes('\0')))throw Error('Invalid computer action text')
 if(action.modifiers!==undefined&&(!Array.isArray(action.modifiers)||action.modifiers.length>3||action.modifiers.some(item=>!['ctrl','shift','alt'].includes(item))))throw Error('Unsupported shortcut modifier')
 if(action.clearFirst!==undefined&&typeof action.clearFirst!=='boolean')throw Error('Invalid text replacement option')
 return structuredClone(action)
}

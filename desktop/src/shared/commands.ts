export type CommandName = 'computer'|'fieldnotes'|'plan'|'ask'|'agent'|'fast'|'reasoning'|'model'|'agents'|'tasks'|'permissions'|'status'|'usage'|'context'|'compact'|'review'|'diff'|'checkpoint'|'rewind'|'fork'|'resume'|'rename'|'new'|'skills'|'mcp'|'memory'|'browser'|'hooks'|'init'|'goal'|'help'
export type CommandDefinition = {name:CommandName;description:string;argument?:string;session?:boolean;shortcut?:string}
export const commands: readonly CommandDefinition[] = [
  {name:'plan',description:'Plan with reading tools, milestones and acceptance criteria',argument:'optional prompt'},
  {name:'ask',description:'Require approval for actions'},{name:'agent',description:'Execute within granted project permissions'},
  {name:'fast',description:'Use a verified provider speed tier',argument:'on | off',session:true},
  {name:'reasoning',description:'Choose supported reasoning effort',argument:'effort',session:true},
  {name:'model',description:'Inspect the current model or prepare a provider handoff'},
  {name:'agents',description:'Configure specialists, profiles and delegation'},
  {name:'tasks',description:'Inspect task queue and background jobs'},
  {name:'permissions',description:'Inspect execution mode and pending approvals'},
  {name:'status',description:'Inspect session, runtime, model and limits'},
  {name:'usage',description:'Inspect measured token and account usage'},
  {name:'context',description:'Inspect instructions, files, memory and summaries'},
  {name:'compact',description:'Summarize context at an idle boundary',session:true},
  {name:'review',description:'Review changes and verification evidence'},
  {name:'diff',description:'Inspect changed files and diffs'},
  {name:'checkpoint',description:'Inspect recoverable turn checkpoints'},
  {name:'rewind',description:'Preview selective conflict-aware restoration'},
  {name:'fork',description:'Fork this conversation',session:true},
  {name:'resume',description:'Explicitly resume this retained session',session:true},
  {name:'rename',description:'Set this chat title',argument:'title',session:true},
  {name:'new',description:'Start a new conversation',shortcut:'Ctrl+N'},
  {name:'skills',description:'Browse or explicitly invoke a project skill',argument:'optional name'},
  {name:'mcp',description:'Manage connected tools and resources'},
  {name:'computer',description:'Manage selected Windows application access and takeover'},
  {name:'fieldnotes',description:'Open user-authored guidance and its project/session pointers'},
  {name:'memory',description:'Inspect Hindsight memory and processing'},
  {name:'browser',description:'Open the isolated project browser'},
  {name:'hooks',description:'Review project lifecycle hooks'},
  {name:'init',description:'Draft project instructions for review'},
  {name:'goal',description:'Manage a bounded persistent objective',argument:'optional objective',session:true},
  {name:'help',description:'Search commands and availability',shortcut:'Ctrl+K'}
]
export type ParsedCommand = {kind:'message';text:string}|{kind:'command';name:CommandName;args:string}
export function parseCommand(text:string):ParsedCommand {
  if(text.startsWith('//'))return {kind:'message',text:text.slice(1)}
  if(!text.startsWith('/'))return {kind:'message',text}
  const match=/^\/([a-z]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if(!match||!commands.some(item=>item.name===match[1]))throw new Error('Unknown command. Use /help, or // to send literal slash text.')
  return {kind:'command',name:match[1] as CommandName,args:match[2]?.trim()||''}
}
export function validateCommand(value:unknown):{name:CommandName;args:string;sessionId?:string}{
  if(!value||typeof value!=='object')throw Error('Invalid command')
  const request=value as Record<string,unknown>,definition=commands.find(item=>item.name===request.name)
  if(!definition||typeof request.args!=='string'||request.args.length>16000)throw Error('Invalid command or arguments')
  if(request.sessionId!==undefined&&(typeof request.sessionId!=='string'||!/^[a-f0-9-]{36}$/.test(request.sessionId)))throw Error('Invalid session identity')
  if(definition.session&&!request.sessionId)throw Error('Create or open a session first')
  return {name:definition.name,args:request.args,sessionId:request.sessionId as string|undefined}
}
export type CommandResult={view?:string;prompt?:string;sessionId?:string;message?:string}

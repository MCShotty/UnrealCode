import { commands } from '../shared/commands'
export function SlashCommands({value,onChoose}:{value:string;onChoose(value:string):void}){
  if(!/^\/[a-z]*$/.test(value))return null
  const matches=commands.filter(item=>item.name.startsWith(value.slice(1)))
  return <div className="slash-commands" role="region" aria-label="Slash commands">{matches.slice(0,9).map(item=><button key={item.name} type="button" onClick={()=>onChoose(`/${item.name}${item.argument?' ':''}`)}><strong>/{item.name}</strong><span>{item.description}</span></button>)}<small>Enter to run · // sends literal slash text · /help shows all commands</small></div>
}

import {execFileSync} from 'node:child_process'
import {existsSync,readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
export function localCredentials(){
const known = []
const collect = (value, field = '') => {
  if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) collect(item, name)
  else if (typeof value === 'string' && value.length > 30 && /token|secret/i.test(field)) known.push(Buffer.from(value))
}
for (const path of new Set([join(homedir(), '.codex/auth.json'), ...(process.env.CODEX_HOME ? [join(process.env.CODEX_HOME, 'auth.json')] : [])])) {
  if (existsSync(path)) collect(JSON.parse(readFileSync(path, 'utf8')))
}
for (const [name, value] of Object.entries(process.env)) if (value && value.length > 30 && /(_API_KEY|_TOKEN)$/.test(name)) known.push(Buffer.from(value))
// A long-running desktop host may not inherit newly configured user variables.
// Capture only named credential sources in private pipes; never print values.
if (process.platform === 'win32') {
  try {
    const script = "$values=@{}; foreach($name in @('TYPESAFE_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY','FIREWORKS_API_KEY','GH_TOKEN','GITHUB_TOKEN')) { $value=[Environment]::GetEnvironmentVariable($name,'User'); if($value){$values[$name]=$value} }; $values | ConvertTo-Json -Compress"
    const values = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide:true, stdio:['ignore','pipe','ignore'], timeout:10000 }).toString())
    for(const value of Object.values(values))if(typeof value==='string'&&value.length>16)known.push(Buffer.from(value))
  } catch { throw new Error('Could not securely inspect named user-environment credentials') }
}
try {
  const token=execFileSync('gh',['auth','token'],{windowsHide:true,stdio:['ignore','pipe','ignore'],timeout:10000}).toString().trim()
  if(token.length>16)known.push(Buffer.from(token))
} catch { /* No accessible GitHub CLI token; pattern scanning still applies. */ }

return known
}

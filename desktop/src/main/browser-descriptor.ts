import {redactContent} from './failures'
/** Conservative text reduction before optional cloud page decisions. */
export function browserDescriptorText(value:string):string{return redactContent(value).split(/\r?\n/).map(line=>/\b(password|passcode|secret|api.?key|access.?token|refresh.?token|cookie|session.?id|one.?time.?code|otp)\b/i.test(line)?'[sensitive line omitted]':line.replace(/\b[A-Za-z0-9_-]{32,}\b/g,'[redacted]')).join('\n')}

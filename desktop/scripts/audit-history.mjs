// Scan reachable blob contents in private pipes; report object IDs/rules only.
import {execFileSync} from 'node:child_process'
import {localCredentials} from './local-credentials.mjs'
import {secretPatterns} from './secret-patterns.mjs'
const git=args=>execFileSync('git',args,{windowsHide:true,maxBuffer:512*1024*1024})
const lines=git(['rev-list','--objects','--all']).toString().trim().split('\n'),names=new Map(lines.map(line=>{const at=line.indexOf(' ');return at<0?[line,'']:[line.slice(0,at),line.slice(at+1)]}))
const sizes=execFileSync('git',['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],{input:[...names.keys()].join('\n')+'\n',maxBuffer:16*1024*1024}).toString().trim().split('\n').map(line=>line.split(' '))
const blobs=sizes.filter(([,type])=>type==='blob'),large=blobs.filter(([, ,size])=>Number(size)>64*1024*1024);if(large.length)throw Error(`Manual large-object review required for ${large.length} blobs`)
const known=localCredentials(),hits=[];let scanned=0,bytes=0
for(let index=0;index<blobs.length;index+=100){const buffer=execFileSync('git',['cat-file','--batch'],{input:blobs.slice(index,index+100).map(([id])=>id).join('\n')+'\n',maxBuffer:256*1024*1024});let offset=0;while(offset<buffer.length){const end=buffer.indexOf(10,offset),[id,type,size]=buffer.subarray(offset,end).toString().split(' ');if(type!=='blob')throw Error('Unexpected Git object');const content=buffer.subarray(end+1,end+1+Number(size));offset=end+1+Number(size)+1;scanned++;bytes+=content.length;if(known.some(key=>content.includes(key)))hits.push({id,path:names.get(id),rule:'exact-local-credential'});if(!content.subarray(0,2048).includes(0))for(const [rule,pattern]of secretPatterns)if(pattern.test(content.toString('utf8')))hits.push({id,path:names.get(id),rule})}}
console.log(JSON.stringify({scope:'all reachable Git blobs',scanned,bytes,localCredentialValuesCompared:known.length,hits}));if(hits.length)process.exitCode=1

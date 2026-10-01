import {randomUUID} from 'node:crypto'
import {redactContent} from './failures'
import type {TimelineEvidence,TimelineStage,TimelineSummary,TimelineView} from '../shared/timeline'

export function validateTimelineSummary(text:string,evidence:TimelineEvidence[],plan:TimelineView['plan']):Pick<TimelineSummary,'summary'|'stageId'|'phase'|'evidence'>{
 if(text.length>8000)throw Error('Timeline summary exceeded its limit')
 const value=JSON.parse(text),allowed=new Set(evidence.map(row=>row.seq))
 if(!value||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>1000||!['working','waiting','completed','blocked'].includes(value.phase)||!Array.isArray(value.evidence)||!value.evidence.length||value.evidence.length>12||value.evidence.some((seq:unknown)=>!Number.isSafeInteger(seq)||!allowed.has(seq as number))||value.stageId!==undefined&&(typeof value.stageId!=='string'||!plan?.milestones.some(row=>row.id===value.stageId)))throw Error('Timeline summary has invalid evidence or stage references')
 return {summary:redactContent(value.summary),phase:value.phase,evidence:[...new Set<number>(value.evidence)],...(value.stageId?{stageId:value.stageId}:{})}
}
export function validateTimelineStages(text:string,evidence:TimelineEvidence[],plan:TimelineView['plan'],previous:TimelineStage[]=[]):TimelineStage[]{
 if(Buffer.byteLength(text)>8000)throw Error('Timeline stages exceeded their limit')
 const value=JSON.parse(text),allowed=new Set(evidence.map(row=>row.seq)),known=new Map(previous.map(stage=>[stage.id,stage])),planIds=new Set(plan?.milestones.map(row=>row.id)),seen=new Set<string>()
 // Older providers/fixtures may still return the bounded legacy shape.
 if(!value.stages){const old=validateTimelineSummary(text,evidence,plan),milestone=plan?.milestones.find(row=>row.id===old.stageId)||plan?.milestones.find(row=>row.state==='running')||plan?.milestones.find(row=>row.state==='pending');return [{id:milestone?.id||previous[0]?.id||randomUUID(),title:milestone?.text||old.summary.slice(0,120),detail:old.summary.slice(0,320),phase:old.phase,evidence:old.evidence,source:plan?'plan':'inferred'}]}
 if(!Array.isArray(value.stages)||!value.stages.length||value.stages.length>12)throw Error('Supply one to twelve timeline stages')
 const stages:TimelineStage[]=value.stages.map((row:any)=>{
  if(!row||typeof row.id!=='string'||row.id.length>120||seen.has(row.id)||typeof row.title!=='string'||!row.title.trim()||row.title.length>120||typeof row.detail!=='string'||row.detail.length>320||!['pending','working','waiting','completed','blocked'].includes(row.phase)||!Array.isArray(row.evidence)||!row.evidence.length||row.evidence.length>12||row.evidence.some((seq:unknown)=>!Number.isSafeInteger(seq)||!allowed.has(seq as number)))throw Error('Timeline stages have invalid text or evidence')
  if(plan?!planIds.has(row.id):!known.has(row.id)&&!/^new:[a-z0-9_-]{1,64}$/.test(row.id))throw Error('Unknown timeline stage identity')
  seen.add(row.id)
  return {id:plan||known.has(row.id)?row.id:randomUUID(),title:plan?.milestones.find(stage=>stage.id===row.id)?.text||redactContent(row.title),detail:redactContent(row.detail),phase:row.phase,evidence:[...new Set<number>(row.evidence)],source:plan?'plan':'inferred'}
 })
 const retained=previous.filter(row=>!seen.has(row.id))
 if(!plan&&retained.length+stages.length>12)throw Error('Preserve and update existing stages within the twelve-stage limit')
 const replacements=new Map(stages.map(row=>[row.id,row]))
 return [...previous.map(row=>replacements.get(row.id)||row),...stages.filter(row=>!known.has(row.id))]
}

/** Disk metadata is untrusted too. Reject corruption without deleting originals. */
export function validateSavedTimeline(rows:unknown):asserts rows is TimelineSummary[]{
 const phases=['working','waiting','completed','blocked'],stagePhases=[...phases,'pending','stopped']
 if(!Array.isArray(rows)||rows.length>500||rows.some(row=>!row||typeof row.id!=='string'||typeof row.workId!=='string'||!Number.isSafeInteger(row.fromSeq)||!Number.isSafeInteger(row.toSeq)||row.fromSeq<1||row.toSeq<row.fromSeq||!Number.isSafeInteger(row.planRevision)||typeof row.summary!=='string'||row.planProgressIdentity!==undefined&&(typeof row.planProgressIdentity!=='string'||! /^[a-f0-9]{64}$/.test(row.planProgressIdentity))||!phases.includes(row.phase)||!Array.isArray(row.evidence)||row.evidence.some((seq:unknown)=>!Number.isSafeInteger(seq)||Number(seq)<row.fromSeq||Number(seq)>row.toSeq)||row.stages!==undefined&&(!Array.isArray(row.stages)||row.stages.length>12||row.stages.some((stage:any)=>!stage||typeof stage.id!=='string'||typeof stage.title!=='string'||typeof stage.detail!=='string'||!stagePhases.includes(stage.phase)||!Array.isArray(stage.evidence)||stage.evidence.some((seq:unknown)=>!row.evidence.includes(seq))))))throw Error('Timeline metadata is unreadable; originals are preserved')
}

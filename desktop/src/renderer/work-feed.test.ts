import {expect,it} from 'vitest'
import {groupWorkFeed,workLabel,workSegmentKey} from './work-feed'
import type {ParsedEntry} from './chat-events'
import type {WorkSummary} from '../shared/activity'
const work={id:'work',state:'completed_with_warnings'} as WorkSummary
it.each([undefined,800,1000])('keeps warnings visible with duration %s',elapsedMs=>expect(workLabel({...work,elapsedMs})).toContain('warnings'))
it('keeps a disclosure identity when older work is prepended',()=>{const entries=[{id:'event-20'}] as ParsedEntry[];expect(workSegmentKey(work,entries)).toBe('work:work');expect(workSegmentKey(work,[{id:'event-10'},...entries] as ParsedEntry[])).toBe(workSegmentKey(work,entries))})
it('groups only adjacent completed reads from one scope and phase',()=>{
 const row=(id:string,phase='inspect'):ParsedEntry=>({id:`call:turn:${id}`,kind:'tool',title:'ReadFile',text:'{"path":"a"}',status:'completed',timestamp:'',phase,stageId:phase,raw:{WorkspaceID:'w'}})
 expect(groupWorkFeed([row('a'),row('b'),row('c','edit')]).map(row=>row.entries.length)).toEqual([2,1])
 expect(groupWorkFeed([row('a'),{...row('b'),status:'failed'},row('c')])).toHaveLength(3)
 expect(groupWorkFeed([row('a'),{...row('b'),id:'call:other:b'}])).toHaveLength(2)
})

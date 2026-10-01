import {expect,it} from 'vitest'
import {dependencyReadChannels} from './dependency-access'
it('permits cached work/activity/timeline and local disclosure preferences while Docker recovery waits',()=>{
 for(const channel of ['work:view','activity:page','activity:detail','conversation:ui','conversation:ui-save','timeline:view','planning:get'])expect(dependencyReadChannels.has(channel)).toBe(true)
})
it('does not permit execution, approvals, input replies, integration or file writes through the read boundary',()=>{
 for(const channel of ['session:send','question:answer','activity:cancel','plan:implement','editor:save','terminal:create','host:respond','workspace:integrate','browser:shared-command','memory:enable'])expect(dependencyReadChannels.has(channel)).toBe(false)
})

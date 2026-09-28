import { expect, it } from 'vitest'
import { offlineSession } from './lifecycle'
import { duration } from './duration'
it('keeps terminal outcomes offline and requires explicit resumption of active work',()=>{
  const session={id:'one',title:'Real title',lastUpdatedAt:'now',active:true}
  for(const state of ['completed','completed_with_warnings','failed','stopped'])expect(offlineSession({...session,state})).toMatchObject({state,active:false,title:'Real title'})
  for(const state of ['running','waiting_input','cancelling'])expect(offlineSession({...session,state}).state).toBe('interrupted')
})
it('does not round short operations to zero seconds or invent missing measurements',()=>{
  expect(duration(12)).toBe('12 ms');expect(duration(1400)).toBe('1.4 s');expect(duration()).toBe('Unknown')
})

/** Cache reads and local presentation preferences do not execute backend work. */
export const dependencyReadChannels=new Set([
 'project:pick','project:open','session:list','session:select','session:latest','session:events','session:event-window',
 'history:page','history:search','workspace:active','settings:update','settings:has-key','settings:save-key',
 'models:health','models:discover','files:changes','work:view','activity:page','activity:detail',
 'conversation:ui','conversation:ui-save','timeline:view','planning:get'
])

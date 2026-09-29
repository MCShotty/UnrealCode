import {afterEach,expect,it} from 'vitest'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {TaskWorkspaces} from './task-workspaces'

const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
it('distinguishes no repository, missing initial commit, nested selection, and a dirty usable root',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-git-availability-'));roots.push(root)
 const state=join(root,'state'),nested=join(root,'nested');await mkdir(nested)
 const availability=(path:string)=>new TaskWorkspaces(path,state).availability()
 expect(await availability(root)).toMatchObject({available:false,code:'GIT_REPOSITORY_REQUIRED'})
 const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{windowsHide:true,stdio:'ignore'})
 git('init');expect(await availability(root)).toMatchObject({available:false,code:'GIT_COMMIT_REQUIRED'})
 await writeFile(join(root,'file.txt'),'initial');git('add','file.txt');git('-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Initial')
 expect(await availability(nested)).toMatchObject({available:false,code:'GIT_ROOT_REQUIRED'})
 await writeFile(join(root,'file.txt'),'dirty');expect(await availability(root)).toEqual({available:true})
})

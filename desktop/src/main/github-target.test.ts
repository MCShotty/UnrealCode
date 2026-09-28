import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const captured = vi.hoisted(() => [] as string[][])
const responses=vi.hoisted(()=>({workflow:false,bodies:[] as unknown[]}))
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util'), real = promisify(actual.execFile)
  return { ...actual, execFile: Object.assign(() => {}, { [promisify.custom]: async (file: string, args: string[], options: object) => {
    if (file === 'git' && ['fetch','pull'].includes(args[0])) {captured.push(['git',...args]);return{stdout:'',stderr:''}}
    if (file !== 'gh') return real(file, args, options)
    captured.push(args)
    if(args[0]==='auth'&&args[1]==='status')return{stdout:JSON.stringify({hosts:{'github.enterprise.test':[{state:'success',active:true}]}}),stderr:''}
    if(responses.workflow){
      if(args.includes('--input')){responses.bodies.push(JSON.parse(await readFile(args[args.indexOf('--input')+1],'utf8')));return{stdout:'{}',stderr:''}}
      if(args.includes('headRefOid'))return{stdout:'a'.repeat(40),stderr:''}
      if(args.includes('statusCheckRollup'))return{stdout:JSON.stringify({statusCheckRollup:[{name:'Tests',conclusion:'FAILURE',detailsUrl:'https://github.com/acme/private-fork/actions/runs/22/job/33'}]}),stderr:''}
      if(args[0]==='api')return{stdout:JSON.stringify([[{id:31,body:'Fix the selected behavior',path:'src/app.ts',line:7,html_url:'https://github.com/acme/private-fork/pull/17#discussion_r31',user:{login:'reviewer'}}]]),stderr:''}
      if(args[0]==='run')return{stdout:'Selected job failure',stderr:''}
    }
    const stdout = args[1] === 'list' ? '[]' : args[1] === 'view' ? '{"number":17,"comments":[]}' : ''
    return { stdout, stderr: '' }
  } }) }
})
import { githubPullRequests, githubPullRequest, githubCreatePullRequest, githubReviewPullRequest,githubReviewComments,githubFailureLogs,githubRemoteState,githubPush,githubFetch,githubPull } from './github'
let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); captured.length = 0;responses.workflow=false;responses.bodies=[] })
it.each(['https://github.com/acme/private-fork.git', 'git@github.com:acme/private-fork.git'])('pins PR requests to origin %s instead of gh inherited defaults', async origin => {
  root = await mkdtemp(join(tmpdir(), 'unrealcode-gh-target-'))
  execFileSync('git', ['init', root], { windowsHide: true, stdio: 'ignore' })
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', origin], { windowsHide: true })
  execFileSync('git', ['-C', root, 'remote', 'add', 'upstream', 'https://github.com/acme/public-upstream.git'], { windowsHide: true })
  await githubPullRequests(root)
  await githubPullRequest(root, 17)
  execFileSync('git', ['-C', root, 'symbolic-ref', 'HEAD', 'refs/heads/feature'], { windowsHide: true })
  await githubCreatePullRequest(root, 'Fixture', 'Body', 'main', true)
  await githubReviewPullRequest(root, 17, 'comment', 'Fixture review')
  expect(captured).toHaveLength(5)
  for (const args of captured) {
    const index = args.indexOf('--repo')
    expect(index).toBeGreaterThan(-1)
    expect(args[index + 1]).toBe('github.com/acme/private-fork')
  }
})
it('reads paginated comments and selected logs from origin and binds review submission to the reviewed commit',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-gh-intake-'));execFileSync('git',['init',root],{stdio:'ignore',windowsHide:true});execFileSync('git',['-C',root,'remote','add','origin','https://github.com/acme/private-fork.git'],{windowsHide:true});responses.workflow=true
 expect((await githubReviewComments(root,17))[0]).toMatchObject({id:31,path:'src/app.ts',line:7})
 expect(await githubFailureLogs(root,17,'https://github.com/acme/private-fork/actions/runs/22/job/33')).toBe('Selected job failure')
 await expect(githubFailureLogs(root,17,'https://github.com/other/repo/actions/runs/22/job/33')).rejects.toThrow('Select a failed check')
 await expect(githubReviewPullRequest(root,17,'approve','Reviewed','b'.repeat(40),'github.com/acme/private-fork')).rejects.toThrow('changed')
 await githubReviewPullRequest(root,17,'approve','Reviewed','a'.repeat(40),'github.com/acme/private-fork')
 expect(responses.bodies).toEqual([{commit_id:'a'.repeat(40),body:'Reviewed',event:'APPROVE'}]);expect(captured.find(args=>args.includes('--input'))).toContain('repos/acme/private-fork/pulls/17/reviews')
})
it('refuses a push when the commit changed after its preview',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-push-preview-'));execFileSync('git',['init','-b','main',root],{stdio:'ignore',windowsHide:true});execFileSync('git',['-C',root,'remote','add','origin','https://github.com/acme/private-fork.git'],{windowsHide:true});await writeFile(join(root,'file.txt'),'before');execFileSync('git',['-C',root,'add','.']);const commit=()=>execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Fixture'],{stdio:'ignore',windowsHide:true});commit();const expected=await githubRemoteState(root);await writeFile(join(root,'file.txt'),'after');execFileSync('git',['-C',root,'add','.']);commit();await expect(githubPush(root,'main',expected)).rejects.toThrow('changed after the push preview')
})
it('rejects untrusted origin hosts and embedded URL credentials before Git network actions',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-gh-untrusted-'));execFileSync('git',['init',root],{stdio:'ignore',windowsHide:true})
 execFileSync('git',['-C',root,'remote','add','origin','https://untrusted.example/acme/project.git'],{windowsHide:true})
 await expect(githubPullRequests(root)).rejects.toThrow('not an authenticated GitHub host')
 await expect(githubFetch(root)).rejects.toThrow('not an authenticated GitHub host')
 await expect(githubPull(root)).rejects.toThrow('not an authenticated GitHub host')
 execFileSync('git',['-C',root,'remote','set-url','origin','https://user:password@github.com/acme/project.git'],{windowsHide:true})
 await expect(githubRemoteState(root)).rejects.toThrow('must not include credentials')
})
it('allows an exact GitHub Enterprise host already authenticated in gh',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-gh-enterprise-'));execFileSync('git',['init',root],{stdio:'ignore',windowsHide:true})
 execFileSync('git',['-C',root,'remote','add','origin','git@github.enterprise.test:acme/project.git'],{windowsHide:true})
 await githubPullRequests(root)
 expect(captured.some(args=>args[0]==='auth'&&args[1]==='status')).toBe(true)
 expect(captured.find(args=>args[0]==='pr'&&args[1]==='list')).toContain('github.enterprise.test/acme/project')
})
it('pins fetch and pull to the validated origin URL and requires a push preview',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-gh-pinned-'));execFileSync('git',['init','-b','main',root],{stdio:'ignore',windowsHide:true})
 const origin='https://github.com/acme/project.git';execFileSync('git',['-C',root,'remote','add','origin',origin],{windowsHide:true})
 await githubFetch(root);await githubPull(root)
 expect(captured.find(args=>args[0]==='git'&&args[1]==='fetch')).toEqual(['git','fetch','--prune',origin,'+refs/heads/*:refs/remotes/origin/*'])
 expect(captured.find(args=>args[0]==='git'&&args[1]==='pull')).toEqual(['git','pull','--ff-only',origin,'main'])
 await expect(githubPush(root,'main')).rejects.toThrow('Preview')
})

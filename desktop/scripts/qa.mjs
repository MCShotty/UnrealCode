import { _electron as electron } from 'playwright'
import { resolve, join, sep, dirname } from 'node:path'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const desktop = resolve(import.meta.dirname, '..')
const packaged = process.argv.includes('--packaged')
const executablePath = packaged ? resolve(process.env.UNREALCODE_QA_EXECUTABLE || resolve(desktop, 'dist/win-unpacked/UnrealCode.exe')) : resolve(desktop, 'node_modules/electron/dist/electron.exe')
const qaData = mkdtempSync(join(tmpdir(), 'unrealcode-qa-'))
const screenshots = join(qaData, 'screens')
mkdirSync(screenshots)
const qaWorkspace = process.argv.includes('--skills') || process.argv.includes('--temp-workspace') || process.argv.includes('--github-actions') ? mkdtempSync(join(tmpdir(), 'unrealcode-workspace-qa-')) : null
const launchEnv = { ...process.env, UNREAL_DESKTOP_USER_DATA: qaData, UNREAL_DESKTOP_BACKGROUND_CHECK: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
if (process.argv.includes('--no-docker')) {
  // Windows environment names are case-insensitive. Keeping both Path and
  // PATH can let the inherited Docker path win, defeating this fixture.
  for(const key of Object.keys(launchEnv))if(key.toLowerCase()==='path')delete launchEnv[key]
  launchEnv.PATH = `${process.env.SystemRoot || 'C:\\Windows'}\\System32;${process.env.SystemRoot || 'C:\\Windows'}`
}
const instance = await electron.launch({ executablePath, args: packaged ? [] : ['.'], cwd: packaged ? dirname(executablePath) : desktop, env: launchEnv })
let qaContainer = ''
try {
  const page = await instance.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Choose a decision engine' }).waitFor({ timeout: 15000 })
  await page.screenshot({ path: join(screenshots, 'desktop-onboarding-current.png') })
  if (process.argv.includes('--decision')) await page.locator('.engine-options button').first().click()
  else await page.getByRole('button', { name: 'Set up later' }).click()
  await page.getByRole('heading', { name: 'Open a workspace' }).waitFor({ timeout: 15000 })
  await page.screenshot({ path: join(screenshots, 'desktop-current.png') })
  const result = { title: await page.title(), heading: await page.getByRole('heading', { name: 'Open a workspace' }).innerText(), errors }
  result.userData = await instance.evaluate(({ app }) => app.getPath('userData'))
  if (process.argv.includes('--no-docker')) {
    result.dockerStatus = await page.evaluate(() => window.unreal.dockerStatus())
    const failure = result.dockerStatus.failure
    const requiredAction = { DOCKER_MISSING: 'docker-help', DOCKER_UNAVAILABLE: 'docker-open', DOCKER_WINDOWS_ENGINE: 'docker-help', DOCKER_CONTEXT: 'docker-help', DOCKER_TIMEOUT:'docker-open' }[failure?.code]
    if (result.dockerStatus.ready || result.dockerStatus.phase !== 'unavailable' || !requiredAction || !failure.actions.includes(requiredAction) || !failure.actions.includes('retry')) throw new Error(`Missing actionable Docker guidance: ${failure?.code || 'no failure'}; ${failure?.details||result.dockerStatus.message}`)
  }
  if (process.argv.includes('--credentials')) {
    await page.evaluate(() => window.unreal.saveKey('openai', 'qa-only-value-not-a-real-key'))
    result.keyStored = await page.evaluate(() => window.unreal.hasKey('openai'))
    const secretPath = join(qaData, 'secrets.json')
    result.keyEncryptedAtRest = existsSync(secretPath) && !readFileSync(secretPath, 'utf8').includes('qa-only-value-not-a-real-key')
  }
  if (process.argv.includes('--workspace')) {
    await instance.evaluate(({ dialog }) => { dialog.showMessageBox = async (...args) => { const options = args.at(-1); if (!['Trust this workspace?', 'Allow TypeSafe decisions?'].includes(options?.title)) throw new Error('Unexpected native dialog'); return { response: 0, checkboxChecked: false } } })
    const workspace = qaWorkspace || resolve(desktop, '..')
    if (process.argv.includes('--github-actions')) {
      execFileSync('git', ['init', '-b', 'main', workspace], { windowsHide: true })
      writeFileSync(join(workspace, 'sample.txt'), 'UnrealCode GitHub workflow QA\n')
    }
    try { result.workspace = await page.evaluate((path) => window.unreal.openProject(path, true), workspace) }
    catch (error) {
      result.workspaceError = String(error)
      console.log(JSON.stringify(result))
      process.exitCode = 1
      throw error
    }
    qaContainer = result.workspace.container || ''
    await page.reload()
    await page.getByRole('button', { name: 'Chat' }).waitFor({ timeout: 120000 })
    await page.screenshot({ path: join(screenshots, 'desktop-workspace-current.png') })
    result.navigation = await page.locator('nav button').allTextContents()
    if (process.argv.includes('--github-actions')) {
      result.githubBranch = await page.evaluate(() => window.unreal.githubBranch())
      await page.evaluate(() => window.unreal.githubStage(['sample.txt']))
      result.githubCommit = await page.evaluate(() => window.unreal.githubCommit('Add sample file'))
      result.githubWorktree = await page.evaluate(() => window.unreal.githubCreateWorktree('feature/qa', 'main'))
      result.githubWorktrees = await page.evaluate(() => window.unreal.githubWorktrees())
    }
    if (process.argv.includes('--light')) {
      await page.evaluate(() => window.unreal.updateSettings({ theme: 'light' }))
      await page.reload()
      await page.getByRole('button', { name: 'Chat', exact: true }).waitFor()
      await page.screenshot({ path: join(screenshots, 'desktop-light-current.png') })
      result.lightTheme = await page.evaluate(() => document.documentElement.dataset.theme)
      await page.evaluate(() => window.unreal.updateSettings({ theme: 'dark' }))
      await page.reload()
    }
    if (process.argv.includes('--decision')) {
      result.decisionStatus = await page.evaluate(() => window.unreal.decisionStatus())
      if (!result.decisionStatus.available) throw new Error(`Decision engine unavailable: ${result.decisionStatus.message}`)
      result.decision = await page.evaluate(() => window.unreal.evaluateDecision({ state: { text: 'Please fix the failing build.' }, sourceRefs: ['qa-synthetic'], questions: {
        route: { type: 'choice', instructions: 'Which route fits text?', criteria: { implementation: 'change code', explanation: 'answer only', other: 'unclear' } },
        security: { type: 'noul', instructions: 'Does text mention credentials or access control?' }
      } }))
    }
    if (process.argv.includes('--motion')) {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      result.reducedMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
      for (const name of ['Files', 'Settings', 'Chat', 'Sessions', 'Chat']) {
        await page.getByRole('button', { name, exact: true }).click()
      }
      result.motionNavigation = await page.getByRole('button', { name: 'Chat', exact: true }).getAttribute('class')
    }
    if (process.argv.includes('--stress')) {
      await page.locator('.session-row').first().waitFor({ timeout: 10000 })
      const id = (await page.evaluate(() => window.unreal.listSessions()))[0].id
      await page.locator('.session-row').first().click()
      await page.locator('.session-row.selected').waitFor()
      await page.locator('.markdown').first().waitFor({ timeout: 30000 })
      await instance.evaluate(({ BrowserWindow }, target) => {
        const webContents = BrowserWindow.getAllWindows()[0].webContents
        for (let index = 0; index < 500; index++) webContents.send('agent:event', { v: 1, event: 'operation.update', sessionId: target, seq: 100000 + index, payload: { ID: 'qa-op', Type: 'shell', Status: 'awaiting' } })
      }, id)
      await page.getByText('qa-op').first().waitFor({ timeout: 10000 })
      result.stressToolCards = await page.locator('.tool-card').count()
      if (result.stressToolCards < 1) throw new Error('Activity cards disappeared during the event burst')
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Chat', exact: true }).click()
    }
    if (process.argv.includes('--stop')) {
      await page.locator('.session-row').first().waitFor({ timeout: 10000 })
      await page.locator('.session-row').first().click()
      await page.locator('.session-row.selected').waitFor()
      await page.getByRole('button', { name: 'Stop', exact: true }).click()
      await page.locator('.session-row.selected small').getByText('Saved', { exact: false }).waitFor({ timeout: 30000 })
      result.stopped = true
    }
    if (process.argv.includes('--flows')) {
      await page.getByRole('button', { name: 'Files', exact: true }).click()
      await page.getByRole('heading', { name: 'Files' }).waitFor()
      result.files = await page.locator('.file-row').count()
      await page.getByRole('button', { name: /^Changes/ }).click()
      const change = page.locator('.file-row').filter({ hasText: '.gitignore' }).first()
      if (await change.count()) {
        await change.click()
        await page.getByText('/desktop/node_modules/', { exact: false }).first().waitFor({ timeout: 10000 })
        result.diffPreview = (await page.locator('.file-preview pre').innerText()).includes('desktop/node_modules')
      }
      await page.getByRole('button', { name: 'Skills', exact: true }).click()
      await page.getByRole('heading', { name: 'Skills' }).waitFor()
      result.skills = await page.locator('.skill-row').count()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('heading', { name: 'Settings' }).waitFor()
      result.codex = await page.evaluate(() => window.unreal.codexStatus())
      result.github = await page.evaluate(() => window.unreal.githubStatus())
      await page.getByRole('button', { name: 'GitHub', exact: true }).click()
      await page.getByRole('heading', { name: 'GitHub', exact: true }).waitFor()
      result.githubPage = await page.locator('.github-connection').innerText()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByPlaceholder('Optional instructions for this workspace').fill('QA project instructions')
      await page.getByRole('button', { name: 'Save settings' }).click()
      await page.getByText('Settings saved', { exact: true }).waitFor()
      result.projectInstructionsSaved = await page.evaluate(async () => {
        const path = await window.unreal.projectPath()
        return !!path && (await window.unreal.getSettings()).projectInstructions[path] === 'QA project instructions'
      })
      if (!result.projectInstructionsSaved) throw new Error('Project instructions were not persisted under the canonical project path')
      await page.getByRole('button', { name: 'Terminal', exact: true }).click()
      await page.getByRole('heading', { name: 'Terminal' }).waitFor()
      await page.locator('.xterm-screen').waitFor({ timeout: 10000 })
      await page.locator('.xterm-helper-textarea').focus()
      await page.keyboard.type('echo QA_TERMINAL_OK')
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => ((document.querySelector('.xterm-screen')?.textContent || '').match(/QA_TERMINAL_OK/g) || []).length >= 2, null, { timeout: 10000 })
      result.terminalOutput = (await page.locator('.xterm-screen').innerText()).slice(-200)
      await page.screenshot({ path: join(screenshots, 'desktop-terminal-current.png') })
      result.terminalError = await page.locator('.terminal-page .error-inline').allTextContents()
      await page.getByRole('button', { name: 'Chat', exact: true }).click()
    }
    if (process.argv.includes('--skills')) {
      await page.getByRole('button', { name: 'Skills', exact: true }).click()
      await page.getByRole('button', { name: 'New skill' }).click()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.locator('.skill-row').first().waitFor({ timeout: 10000 })
      result.skillCreated = (await page.evaluate(() => window.unreal.listSkills())).length === 1
      page.once('dialog', (dialog) => void dialog.accept())
      await page.getByRole('button', { name: 'Disable skill' }).click()
      await page.locator('.skill-row').first().waitFor({ state: 'detached', timeout: 10000 })
      result.skillDisabled = (await page.evaluate(() => window.unreal.listSkills())).length === 0
    }
    if (process.argv.includes('--resume')) {
      const existing = page.locator('.session-row')
      await existing.first().waitFor({ timeout: 10000 })
      result.savedSessions = await existing.count()
      if (result.savedSessions > 0) {
        await existing.first().click()
        await page.locator('.markdown').first().waitFor({ timeout: 30000 })
        result.replayedReply = await page.locator('.markdown').first().innerText()
        result.replayedToolCards = await page.locator('.tool-card').count()
        await page.screenshot({ path: join(screenshots, 'desktop-tool-current.png') })
        if (!process.argv.includes('--replay-only')) {
        await page.getByRole('button', { name: 'Usage', exact: true }).click()
        await page.getByRole('heading', { name: 'Usage' }).waitFor()
        result.usage = await page.locator('.stat-box strong').allTextContents()
        await page.getByRole('button', { name: 'Sessions', exact: true }).click()
        await page.getByRole('button', { name: 'Fork session' }).first().click()
        await page.locator('.session-row.selected').waitFor({ timeout: 30000 })
        result.forkedSessions = await page.locator('.session-row').count()
        }
      }
    }
    if (process.argv.includes('--live')) {
      const prompt = process.argv.includes('--implementation') ? 'Create a file named checkpoint.txt containing exactly QA_CHECKPOINT_OK. Use Bash to verify its contents, then reply with exactly QA_CHECKPOINT_OK.' : process.argv.includes('--benchmark') ? 'Inspect the current workspace with Bash, run pwd, and check that the reported directory matches the mounted project location. Answer only with the directory path.' : process.argv.includes('--tool') ? 'Use Bash to run pwd, then answer with only the directory printed.' : "Reply with exactly 'UnrealCode ready.' Do not use tools."
      await page.getByLabel('Message UnrealCode').fill(prompt)
      const liveStarted = performance.now()
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      if (process.argv.includes('--tool')) await page.locator('.tool-card').first().waitFor({ timeout: 120000 })
      try { await page.locator('.markdown').first().waitFor({ timeout: 120000 }) }
      catch { result.liveError = await page.locator('.banner-error').allTextContents() }
      result.reply = await page.locator('.markdown').allTextContents()
      result.liveLatencyMs = Math.round(performance.now() - liveStarted)
      result.toolCards = await page.locator('.tool-card').count()
      if (process.argv.includes('--decision') && process.argv.includes('--implementation') && process.argv.includes('--github-actions')) await page.locator('.decision-card').nth(1).waitFor({ timeout: 30000 })
      if (process.argv.includes('--decision')) result.decisionCards = await page.locator('.decision-card').count()
      if (process.argv.includes('--implementation') && qaWorkspace) result.implementationFile = existsSync(join(qaWorkspace, 'checkpoint.txt')) ? readFileSync(join(qaWorkspace, 'checkpoint.txt'), 'utf8').trim() : null
      await page.screenshot({ path: join(screenshots, 'desktop-live-current.png') })
    }
  }
  console.log(JSON.stringify(result))
} finally {
  await instance.close()
  if (qaData.startsWith(tmpdir() + sep)) rmSync(qaData, { recursive: true, force: true })
  if (qaWorkspace && qaWorkspace.startsWith(tmpdir() + sep)) {
    const digest = createHash('sha256').update(qaWorkspace.toLocaleLowerCase()).digest('hex').slice(0, 20)
    if (qaContainer) { try { execFileSync('docker', ['stop', '--time', '3', qaContainer], { windowsHide: true, stdio: 'ignore' }) } catch { /* Already stopped. */ } }
    try { execFileSync('docker', ['volume', 'rm', `unrealcode-${digest}`], { windowsHide: true, stdio: 'ignore' }) } catch { /* Keep the volume if Docker is unavailable. */ }
    rmSync(qaWorkspace, { recursive: true, force: true })
  }
}

import assert from 'node:assert/strict'

// Runs inside qa-material's disposable real Electron/Docker session. Synthetic
// event bursts below target renderer telemetry only; no project data is changed.
export async function checkExpressiveMotion(app, page, sessionId, report) {
  const still = value => value === 'none' || /^matrix\(1, 0, 0, 1, 0, 0\)$/.test(value)
  const nav = name => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await nav('Chat').click(); await page.locator('.composer textarea').waitFor()
  const project = await page.evaluate(() => window.unreal.projectPath())
  const draft = await page.locator('.composer textarea').inputValue()
  const action = page.locator('.new-task-button'), box = await action.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  const pressed = await action.evaluate(element => new Promise(resolve => {
    const values = []; let frame = 0
    const sample = () => { values.push(getComputedStyle(element.querySelector('.expressive-button-face') || element).transform); if (++frame < 12) requestAnimationFrame(sample); else resolve(values) }; sample()
  }))
  // Release away from the button: this is a visual press test, not a new task.
  await page.mouse.move(1, 1); await page.mouse.up()
  assert(pressed.some(value => !still(value)), 'Focal action should have spring feedback')
  report.checks.push('Expressive spring press feedback is observable')

  for (let i = 0; i < 8; i++) { await nav(i % 2 ? 'Hooks' : 'Settings').click({ force: true }) }
  await nav('Chat').click({ force: true }); await page.locator('.composer textarea').waitFor()
  assert.equal(await page.locator('.view-frame').count(), 1, 'Navigation must not retain outgoing page stacks')
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Toggle session pane' }).click({ force: true })
  await page.waitForFunction(() => document.querySelectorAll('.session-pane').length === 1 && getComputedStyle(document.querySelector('.session-pane')).opacity === '1')
  const tool = page.locator('.work-disclosure').first(),section=page.locator('.work-section').first()
  if(await tool.getAttribute('aria-expanded')==='true'){await tool.click();await section.locator('.work-content').waitFor({state:'detached'})}
  for (let i = 0; i < 9; i++) await tool.click({ force: true })
  assert.equal(await tool.getAttribute('aria-expanded'), 'true')
  await section.locator('.compact-work-event').first().waitFor()
  await tool.click({ force: true }); await section.locator('.work-content').waitFor({ state: 'detached' })
  for (let i = 0; i < 8; i++) await page.locator('.model-picker > summary').click({ force: true })
  assert.equal(await page.locator('.model-picker').getAttribute('open'), null)
  await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: 'Command palette' }).waitFor(); await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'detached' })
  report.checks.push('Rapid navigation, pane toggles, popovers, palette and tool expansion settle at the latest action')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  // Allow the React subscription to observe the change; do not reload to mask it.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const reducedBox = await action.boundingBox()
  await page.mouse.move(reducedBox.x + reducedBox.width / 2, reducedBox.y + reducedBox.height / 2); await page.mouse.down()
  const reducedTransforms = await action.evaluate(element => new Promise(resolve => { const values = []; let frame = 0; const sample = () => { values.push(getComputedStyle(element.querySelector('.expressive-button-face') || element).transform); if (++frame < 16) requestAnimationFrame(sample); else resolve(values) }; sample() }))
  await page.mouse.move(1, 1); await page.mouse.up()
  assert(reducedTransforms.every(still), 'Changing reduced motion at runtime must remove spatial press feedback')
  await nav('Settings').click(); await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
  assert(still(await page.locator('.view-frame').evaluate(element => getComputedStyle(element.querySelector('.expressive-button-face') || element).transform)))
  await nav('Chat').click(); await page.locator('.composer textarea').waitFor()
  report.checks.push('Runtime reduced-motion switch disables spatial feedback and page travel')

  const burst = async (start, count) => app.evaluate(({ BrowserWindow }, { sessionId, start, count }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    for (let i = start; i < start + count; i++) contents.send('agent:event', { v: 1, event: 'session.item', sessionId, seq: 10000 + i, payload: { Kind: 'model_response', Data: { Response: { Output: [{ Type: 'message', Data: { Text: `MOTION_BURST_${i}: stationary incoming text.` } }] } } } })
  }, { sessionId, start, count })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const send = page.locator('.new-task-button'), sendBox = await send.boundingBox()
  await page.mouse.move(sendBox.x + sendBox.width / 2, sendBox.y + sendBox.height / 2); await page.mouse.down()
  const restored = await send.evaluate(element => new Promise(resolve => { const values = []; let frame = 0; const sample = () => { values.push(getComputedStyle(element.querySelector('.expressive-button-face') || element).transform); if (++frame < 12) requestAnimationFrame(sample); else resolve(values) }; sample() }))
  await page.mouse.move(1, 1); await page.mouse.up()
  assert(restored.some(value => !still(value)), 'Controls mounted with reduced motion must animate when the preference is turned off')
  report.checks.push('Motion can be re-enabled without remounting the app or submitting a draft')
  await burst(0, 70); await page.locator('.markdown').getByText('MOTION_BURST_69: stationary incoming text.', { exact: true }).waitFor()
  await page.locator('.chat-scroll').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll', { bubbles: true })) })
  const burstStarted = performance.now()
  await burst(70, 400); await page.locator('.markdown').getByText('MOTION_BURST_469: stationary incoming text.', { exact: true }).waitFor()
  report.motionBurstMs = Math.round(performance.now() - burstStarted)
  const sample = await page.evaluate(() => ({ scroll: document.querySelector('.chat-scroll').scrollTop, transforms: [...document.querySelectorAll('.markdown, .chat-motion, .chat-scroll, .view-frame')].map(element => getComputedStyle(element.querySelector('.expressive-button-face') || element).transform) }))
  assert(sample.transforms.every(still), 'Streaming content and its ancestors must not receive spatial animation')
  assert.equal(sample.scroll, 0, 'Incoming events must preserve the reading position')
  report.checks.push('400-event burst keeps content stationary and preserves the reading position')
  // Restore canonical history before the rest of the UI acceptance checks.
  await page.reload(); await page.getByRole('navigation', { name: 'Main navigation' }).waitFor()
  await app.evaluate(({ BrowserWindow }, target) => BrowserWindow.getAllWindows()[0].webContents.send('app:navigate', target), { project, sessionId })
  await page.getByRole('heading', { name: 'A clear starting point' }).waitFor()
  await page.locator('.composer textarea').fill(draft)
}

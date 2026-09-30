import './desktop-api'
import { FailureCenter } from './FailureCenter'
import { ReleaseNotice } from './ReleaseNotice'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionPreferences } from './MotionPreferences'
import App from './App'
import '@xterm/xterm/css/xterm.css'
import './material-tokens.css'
import './styles.css'
import './material.css'
import './work-activity.css'
import './expressive-controls.css'
import './release-101.css'
import './shared-browser.css'
import './abilities.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><MotionPreferences><App /><FailureCenter/><ReleaseNotice/></MotionPreferences></StrictMode>
)

import './desktop-api'
import { FailureCenter } from './FailureCenter'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode><MotionPreferences><App /><FailureCenter/></MotionPreferences></StrictMode>
)

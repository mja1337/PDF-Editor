import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import '@fontsource/noto-sans/latin-400.css'
import '@fontsource/noto-sans/latin-400-italic.css'
import '@fontsource/noto-sans/latin-700.css'
import '@fontsource/noto-sans/latin-700-italic.css'
import '@fontsource/noto-sans/latin-900.css'
import '@fontsource/noto-serif/latin-400.css'
import '@fontsource/noto-serif/latin-400-italic.css'
import '@fontsource/noto-serif/latin-700.css'
import '@fontsource/noto-sans-mono/latin-400.css'
import '@fontsource/noto-sans-mono/latin-700.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { RoadmapProvider } from './store/roadmap-provider'
import '@roadmap/ui/index.css'
import './index.module.css'

const root = document.getElementById('root')
if (!root) throw new Error('No #root element in index.html')

createRoot(root).render(
  <StrictMode>
    <RoadmapProvider>
      <App />
    </RoadmapProvider>
  </StrictMode>,
)

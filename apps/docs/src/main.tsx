import '@roadmap/ui/index.css'
import classNames from 'classnames/bind'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import styles from './document.module.css'

const cx = classNames.bind(styles)

const root = document.getElementById('root')
if (!root) throw new Error('No #root element in index.html')

document.documentElement.classList.add(cx('document'))
document.body.classList.add(cx('body'))

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

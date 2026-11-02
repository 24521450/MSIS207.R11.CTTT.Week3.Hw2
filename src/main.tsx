import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Không tìm thấy vùng hiển thị ứng dụng.')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

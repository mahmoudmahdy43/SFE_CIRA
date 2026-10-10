import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import App from './App'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import { TooltipProvider } from './components/ui/overlay'

function Root() {
  const { resolved } = useTheme()
  return (
    <TooltipProvider>
      <App />
      <Toaster theme={resolved} position="bottom-right" />
    </TooltipProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  </StrictMode>,
)

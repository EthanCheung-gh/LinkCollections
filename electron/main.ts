import { app, BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerBookmarkHandlers } from './ipc/bookmarks'
import { registerFolderHandlers } from './ipc/folders'
import { registerTagHandlers } from './ipc/tags'
import { registerSettingsHandlers } from './ipc/settings'
import { registerImportExportHandlers } from './ipc/import-export'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged

if (isDevelopment) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload', 'preload.js')
  console.log('Preload path:', preloadPath)
  console.log('Is development:', isDevelopment)
  console.log('__dirname:', __dirname)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#F9FAFB',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    },
    titleBarStyle: 'default',
    minWidth: 1200,
    minHeight: 700,
    show: false
  })

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error('Failed to load:', errorCode, errorDescription, validatedURL)
    }
  )

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully')
  })

  mainWindow.webContents.on('console-message', (_event, _level, message, _line, _sourceId) => {
    console.log(`[Renderer Console] ${message}`)
  })

  if (isDevelopment) {
    const devServerUrl = 'http://localhost:5173'

    mainWindow.webContents.openDevTools()

    const csp =
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self';"

    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      })
    })

    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
    })

    mainWindow.loadURL(devServerUrl)
  } else {
    const htmlPath = path.join(__dirname, '../dist/index.html')
    console.log('Loading HTML from:', htmlPath)

    const csp =
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self';"

    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      })
    })

    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
    })

    mainWindow.loadFile(htmlPath).catch(error => {
      console.error('Failed to load HTML file:', error)
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  registerBookmarkHandlers()
  registerFolderHandlers()
  registerTagHandlers()
  registerSettingsHandlers()
  registerImportExportHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

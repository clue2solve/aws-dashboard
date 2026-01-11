const { app, BrowserWindow, Menu, shell, dialog } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')

let mainWindow
let backendProcess
const BACKEND_PORT = 54321
const FRONTEND_PORT = 54320

// Check if a port is available
function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.request({ host: 'localhost', port, method: 'GET', path: '/api/health' }, (res) => {
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

// Wait for backend to be ready
async function waitForBackend(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const isReady = await checkPort(BACKEND_PORT)
    if (isReady) return true
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

// Start the Python backend
function startBackend() {
  const backendPath = path.join(__dirname, '..', 'backend')
  const venvPython = path.join(backendPath, 'venv', 'bin', 'python')

  // Try venv python first, fall back to system python
  const pythonPath = require('fs').existsSync(venvPython) ? venvPython : 'python3'

  backendProcess = spawn(pythonPath, ['main.py'], {
    cwd: backendPath,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })

  backendProcess.stdout.on('data', (data) => {
    console.log(`Backend: ${data}`)
  })

  backendProcess.stderr.on('data', (data) => {
    console.error(`Backend Error: ${data}`)
  })

  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`)
  })
}

// Create the main window
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'icons', 'icon.png'),
    show: false,
  })

  // Show loading screen
  mainWindow.loadFile(path.join(__dirname, 'loading.html'))
  mainWindow.show()

  // Start backend
  startBackend()

  // Wait for backend
  const backendReady = await waitForBackend()

  if (!backendReady) {
    dialog.showErrorBox('Backend Error', 'Failed to start the backend server. Please check your Python installation.')
    app.quit()
    return
  }

  // Load the frontend
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`)
  } else {
    // In production, serve from built files
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'))
  }

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Create application menu
function createMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Updates...',
          click: () => shell.openExternal('https://github.com/clue2solve/aws-dashboard/releases')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => mainWindow?.webContents.send('show-shortcuts')
        },
        { type: 'separator' },
        {
          label: 'GitHub Repository',
          click: () => shell.openExternal('https://github.com/clue2solve/aws-dashboard')
        },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/clue2solve/aws-dashboard/issues')
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// App lifecycle
app.whenReady().then(() => {
  createMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Kill backend process
  if (backendProcess) {
    backendProcess.kill()
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill()
  }
})

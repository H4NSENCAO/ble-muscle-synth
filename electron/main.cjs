const { app, BrowserWindow, session } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Grant serial port permission
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'serial') {
      callback(true)
    } else {
      callback(false)
    }
  })

  // Handle serial port selection — show native OS picker
  win.webContents.session.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault()

    if (portList.length === 0) {
      callback('')
      return
    }

    const { dialog } = require('electron')
    const buttons = portList.map(p => `${p.displayName || p.portName} (${p.portId})`)
    buttons.push('Cancel')

    dialog.showMessageBox(win, {
      type: 'question',
      title: 'Select Serial Port',
      message: 'Choose a USB serial device:',
      buttons,
      cancelId: buttons.length - 1,
    }).then(({ response }) => {
      if (response === buttons.length - 1) {
        callback('')
      } else {
        callback(portList[response].portId)
      }
    })
  })

  // In production load the built files; in dev load the Vite dev server
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../dist-web/index.html'))
  } else {
    win.loadURL('http://localhost:5173')
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// App de escritorio: envuelve el backend y el panel en una ventana propia,
// con ícono en la bandeja, atajo global de pánico y notificaciones.
//
//   npm run desktop        → usa el panel compilado (panel/dist)
//   npm run desktop:dev    → usa el panel de Vite en :5173 (recarga en caliente)
import { app, BrowserWindow, Tray, Menu, globalShortcut, Notification, shell, nativeImage, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'electron', 'assets');
const DEV = process.argv.includes('--dev');
const APP_NAME = 'stream-interact';

// El backend busca .env, config/, data/ y panel/ desde la carpeta de trabajo
process.chdir(ROOT);
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('com.sopahelada.streaminteract');

// Solo una instancia: si la abres otra vez, se enfoca la ventana existente
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(boot);
}

let backend = null;
let win = null;
let tray = null;
let quitting = false;
let trayHintShown = false;
let lastPaused = null;
let lastServerState = null;

async function boot() {
  Menu.setApplicationMenu(null);
  try {
    const { startApp } = await import(pathToFileURL(path.join(ROOT, 'src', 'app.js')).href);
    backend = await startApp();
  } catch (err) {
    dialog.showErrorBox('No se pudo iniciar stream-interact', `${err.message}\n\nRevisa tu archivo .env en:\n${ROOT}`);
    app.exit(1);
    return;
  }

  createTray();
  createWindow();
  registerShortcut();
  setInterval(refreshTray, 1500);
}

// ---------- Ventana ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: '#0e0e12',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true }
  });

  const appUrl = DEV ? 'http://localhost:5173' : backend.url;
  win.loadURL(appUrl);
  win.once('ready-to-show', () => win.show());

  // Lo que no es el panel (login de Twitch, enlaces externos) se abre en tu navegador normal
  const isPanel = (url) => url.startsWith(appUrl) && !new URL(url).pathname.startsWith('/auth/');
  win.webContents.on('will-navigate', (e, url) => {
    if (!isPanel(url)) {
      e.preventDefault();
      shell.openExternal(url.startsWith('/') ? backend.url + url : url.replace('http://localhost:5173', backend.url));
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Cerrar la ventana la manda a la bandeja; la app sigue funcionando
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      notify('Sigo funcionando en la bandeja', 'Para salir del todo: clic derecho en el ícono → Salir.');
    }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- Bandeja del sistema ----------

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
  tray.on('click', showWindow);
  refreshTray();
}

function refreshTray() {
  if (!tray || !backend) return;
  const { paused, pending } = backend.bus.status();
  const server = backend.mcServer.status();

  // Avisar si el servidor se cae mientras la ventana está oculta
  if (lastServerState && lastServerState !== 'crashed' && server.state === 'crashed') {
    notify('El servidor de Minecraft se cayó', server.autoRestart ? 'Reiniciando en 10 segundos…' : 'Revisa la consola en el panel.');
  }
  lastServerState = server.state;

  if (paused !== lastPaused) {
    tray.setImage(nativeImage.createFromPath(path.join(ASSETS, paused ? 'tray-paused.png' : 'tray.png')));
    lastPaused = paused;
  }
  tray.setToolTip(`${APP_NAME} — ${paused ? 'EN PAUSA' : 'activo'}${pending ? ` · ${pending} en cola` : ''}`);

  const owned = ['starting', 'running', 'stopping'].includes(server.state);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir panel', click: showWindow },
    { type: 'separator' },
    { label: paused ? '▶  Reanudar interacciones' : '⏸  Pausar interacciones', accelerator: shortcut, click: togglePause },
    { type: 'separator' },
    {
      label: 'Servidor de Minecraft',
      enabled: server.configured,
      submenu: [
        { label: 'Iniciar', enabled: !owned && server.state !== 'external', click: () => safe(() => backend.mcServer.start()) },
        { label: 'Reiniciar', enabled: server.state === 'running', click: () => safe(() => backend.mcServer.restart()) },
        { label: 'Detener', enabled: owned && server.state !== 'stopping', click: () => safe(() => backend.mcServer.stop()) }
      ]
    },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() }
  ]));
}

// ---------- Atajo global de pánico ----------

const shortcut = process.env.PANIC_SHORTCUT || 'CommandOrControl+Shift+P';

function registerShortcut() {
  const ok = globalShortcut.register(shortcut, togglePause);
  if (!ok) notify('Atajo no disponible', `${shortcut} ya lo usa otro programa. Cámbialo con PANIC_SHORTCUT en el .env.`);
}

function togglePause() {
  const { paused } = backend.bus.status();
  if (paused) backend.bus.resume(); else backend.bus.pause();
  notify(paused ? '▶ Interacciones reanudadas' : '⏸ Interacciones en pausa',
    paused ? 'El chat vuelve a controlar el juego.' : `Nada del chat se ejecuta. ${shortcut} para reanudar.`);
  refreshTray();
}

// ---------- Utilidades ----------

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: path.join(ASSETS, 'icon.png'), silent: true }).show();
}

async function safe(fn) {
  try { await fn(); } catch (err) { notify('No se pudo completar la acción', err.message); }
  refreshTray();
}

// ---------- Cierre ----------

// Al salir: apagar el servidor de Minecraft guardando el mundo, y luego cerrar
app.on('before-quit', async (e) => {
  if (quitting || !backend) return;
  e.preventDefault();
  quitting = true;
  globalShortcut.unregisterAll();
  if (backend.mcServer.proc) notify('Cerrando…', 'Guardando el mundo y apagando el servidor de Minecraft.');
  try { await backend.stop(); } catch { /* salir de todos modos */ }
  app.exit(0);
});

app.on('window-all-closed', () => { /* seguimos en la bandeja */ });

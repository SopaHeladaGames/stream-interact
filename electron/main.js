// App de escritorio: envuelve el backend y el panel en una ventana propia,
// con ícono en la bandeja, atajo global de pánico y notificaciones.
//
//   npm run desktop        → usa el panel compilado (panel/dist)
//   npm run desktop:dev    → usa el panel de Vite en :5173 (recarga en caliente)
//   npm run dist           → crea el instalador de Windows (dist-instalador/)
//
// Instalada, la app separa sus archivos (dentro del programa, solo lectura) de tus datos
// (.env, config/, data/, media/), que viven en la carpeta que elijas la primera vez.
import { app, BrowserWindow, Tray, Menu, globalShortcut, Notification, shell, nativeImage, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'electron', 'assets');
const DEV = process.argv.includes('--dev');
// Nombre que ves (ventana, bandeja, notificaciones) y nombre interno (carpeta de ajustes en AppData:
// se queda igual para no perder dónde están tus datos)
const APP_NAME = 'Sopa-ChatBot';
const INTERNAL_NAME = 'stream-interact';

const HIDDEN = process.argv.includes('--oculto'); // al arrancar con Windows: directo a la bandeja

// Archivos de la app (overlay, panel compilado): el backend los busca aquí
process.env.STREAM_INTERACT_ROOT = ROOT;
// Tus datos: en desarrollo, la carpeta del proyecto; instalada, la que elijas (se decide en boot)
let DATA_DIR = ROOT;
app.setName(INTERNAL_NAME);
// Identidad de la app para Windows (notificaciones). La versión de desarrollo usa otra, para que Windows
// no confunda las dos: si comparten identidad, al dar clic a una notificación puede abrir el electron.exe
// de node_modules (la pantalla de bienvenida de Electron) en vez de stream-interact.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.sopahelada.streaminteract' : 'com.sopahelada.streaminteract.dev');
}

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
let lastMenuSignature = null;

async function boot() {
  Menu.setApplicationMenu(null);
  if (app.isPackaged) {
    refreshAutostart();
    DATA_DIR = await resolveDataDir();
    if (!DATA_DIR) { app.exit(0); return; }
  }
  // El backend busca .env, config/, data/ y media/ desde la carpeta de trabajo
  process.chdir(DATA_DIR);
  try {
    const { startApp } = await import(pathToFileURL(path.join(ROOT, 'src', 'app.js')).href);
    backend = await startApp({
      // Selector de carpetas nativo para la página Instalaciones
      pickFolder: async () => {
        const res = await dialog.showOpenDialog(win ?? undefined, { title: 'Carpeta del servidor de Minecraft', properties: ['openDirectory'] });
        return res.canceled ? null : res.filePaths[0];
      },
      // Abrir una carpeta en el Explorador (respaldos)
      openPath: (p) => shell.openPath(p),
      // Otro programa respondiendo en el mismo puerto (ej. otro proyecto de npm en el 3000)
      onPortConflict: (message) => {
        dialog.showMessageBox(win ?? undefined, { type: 'warning', title: `${APP_NAME}: puerto ocupado`, message: 'Otro programa está usando el puerto del panel', detail: message }).catch(() => {});
      },
      // Actualizaciones (solo en la versión instalada): el panel muestra el aviso y el botón
      updates: { status: () => ({ current: app.getVersion(), packaged: app.isPackaged, state: update.state, newVersion: update.version, progress: update.progress, error: update.error }), install: installUpdate, check: () => checkForUpdates(true) }
    });
  } catch (err) {
    dialog.showErrorBox(`No se pudo iniciar ${APP_NAME}`, `${err.message}\n\nRevisa tu archivo .env en:\n${DATA_DIR}`);
    if (app.isPackaged) shell.openPath(DATA_DIR);
    app.exit(1);
    return;
  }

  createTray();
  createWindow();
  registerShortcut();
  setInterval(refreshTray, 1500);
  setupUpdates();
}

// ---------- Actualizaciones automáticas (GitHub Releases) ----------
//
// La versión instalada revisa al abrir y cada 4 horas si hay una versión nueva en
// github.com/SopaHeladaGames/stream-interact/releases. La descarga sola en segundo plano y:
//   - te avisa (notificación, bandeja y panel) con un botón para reiniciar y actualizar, o
//   - se instala sola la próxima vez que salgas de la app.
// Nunca reinicia sola: tú decides cuándo (por ejemplo, no a mitad de un directo).

const update = { state: 'idle', version: null, progress: 0, error: null };

function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // lo hacemos nosotros al salir, después de apagar el servidor
  autoUpdater.on('checking-for-update', () => Object.assign(update, { state: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => Object.assign(update, { state: 'none' }));
  autoUpdater.on('update-available', (info) => Object.assign(update, { state: 'downloading', version: info.version, progress: 0 }));
  autoUpdater.on('download-progress', (p) => { update.progress = Math.round(p.percent); });
  autoUpdater.on('update-downloaded', (info) => {
    Object.assign(update, { state: 'ready', version: info.version, progress: 100 });
    notify(`Versión ${info.version} lista`, 'Reinicia la app cuando quieras para actualizar (o se instala al salir).');
    lastMenuSignature = null;
    refreshTray();
  });
  autoUpdater.on('error', (err) => {
    Object.assign(update, { state: 'error', error: err?.message ?? String(err) });
    console.error('Actualizaciones:', update.error);
  });
  checkForUpdates();
  setInterval(checkForUpdates, 4 * 3600e3);
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) return { ...update, state: 'dev' };
  if (update.state === 'downloading' || update.state === 'ready') return update;
  try { await autoUpdater.checkForUpdates(); } catch (err) { Object.assign(update, { state: 'error', error: err.message }); }
  if (manual && update.state === 'none') notify('Todo al día', `Tienes la versión más reciente (${app.getVersion()}).`);
  if (manual && update.state === 'error') notify('No se pudo buscar la actualización', String(update.error).split('\n')[0].slice(0, 180));
  return update;
}

let installOnQuit = false;
function installUpdate() {
  if (update.state !== 'ready') throw Object.assign(new Error('Todavía no hay una actualización descargada'), { status: 409 });
  installOnQuit = 'restart';
  app.quit(); // primero se apaga todo con calma (before-quit) y luego se instala
  return { ok: true };
}

// ---------- Ventana ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1560,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: APP_NAME,
    icon: path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: '#0e0e12',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true }
  });

  // Ícono de la barra de tareas: sin esto, en desarrollo (y a veces al fijar la app) Windows
  // muestra el ícono de Electron. El .ico tiene que ser un archivo real (fuera del .asar).
  if (process.platform === 'win32') {
    const ico = app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(ASSETS, 'icon.ico');
    try {
      win.setAppDetails({
        appId: app.isPackaged ? 'com.sopahelada.streaminteract' : 'com.sopahelada.streaminteract.dev',
        appIconPath: ico, appIconIndex: 0,
        ...(app.isPackaged ? { relaunchCommand: `"${process.execPath}"`, relaunchDisplayName: APP_NAME } : {})
      });
    } catch { /* no es grave */ }
  }

  const appUrl = DEV ? 'http://localhost:5173' : backend.url;
  win.loadURL(appUrl);

  // Ctrl+R o F5 recargan el panel (útil después de npm run panel:build); Ctrl+Shift+I abre las herramientas de desarrollo
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F5' || (ctrl && !input.shift && input.key.toLowerCase() === 'r')) {
      e.preventDefault();
      win.webContents.reloadIgnoringCache();
    } else if (ctrl && input.shift && input.key.toLowerCase() === 'i') {
      e.preventDefault();
      win.webContents.toggleDevTools();
    }
  });
  win.on('page-title-updated', (e) => e.preventDefault()); // siempre "Sopa-ChatBot"
  win.once('ready-to-show', () => { if (!HIDDEN) win.show(); });

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

  // Reconstruir el menú solo cuando algo cambia (si no, se cerraría mientras lo tienes abierto)
  const startup = app.isPackaged && app.getLoginItemSettings().openAtLogin;
  const signature = `${paused}|${server.state}|${server.configured}|${startup}|${update.state}`;
  if (signature === lastMenuSignature) return;
  lastMenuSignature = signature;

  const owned = ['starting', 'running', 'stopping'].includes(server.state);
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(update.state === 'ready' ? [{ label: `⬆  Reiniciar y actualizar a ${update.version}`, click: () => safe(installUpdate) }, { type: 'separator' }] : []),
    { label: 'Abrir panel', click: showWindow },
    { label: 'Recargar panel', click: () => { win?.webContents.reloadIgnoringCache(); showWindow(); } },
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
    { label: 'Abrir carpeta de datos', click: () => shell.openPath(DATA_DIR) },
    ...(app.isPackaged ? [
      {
        label: 'Iniciar con Windows', type: 'checkbox', checked: startup,
        click: (item) => { setAutostart(item.checked); lastMenuSignature = null; refreshTray(); }
      },
      { label: 'Cambiar carpeta de datos…', click: changeDataDir },
      { label: `Buscar actualizaciones (versión ${app.getVersion()})`, click: () => checkForUpdates(true) }
    ] : []),
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

// ---------- Carpeta de datos (solo instalada) ----------

const LOCATION_FILE = () => path.join(app.getPath('userData'), 'ubicacion.json');

/** La carpeta guardada o, la primera vez, la que elijas. Devuelve null si cancelas. */
async function resolveDataDir() {
  try {
    const { dataDir } = JSON.parse(fs.readFileSync(LOCATION_FILE(), 'utf8'));
    if (dataDir && fs.existsSync(dataDir)) return dataDir;
  } catch { /* primera vez */ }

  while (true) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: APP_NAME,
      message: '¿Dónde guardo tu configuración?',
      detail: 'Aquí van tu .env, las reglas, el historial y la sesión de Twitch.\n\n' +
        'Si ya usabas la app desde una carpeta (por ejemplo C:\\Users\\…\\dev\\stream-interact), ' +
        'elígela y la app usará exactamente la misma configuración.',
      buttons: ['Usar una carpeta existente…', 'Crear una nueva', 'Salir'],
      defaultId: 0, cancelId: 2, noLink: true
    });
    if (response === 2) return null;

    if (response === 0) {
      const res = await dialog.showOpenDialog({ title: 'Carpeta con tu .env', properties: ['openDirectory'] });
      if (res.canceled) continue;
      const dir = res.filePaths[0];
      if (!fs.existsSync(path.join(dir, '.env'))) {
        await dialog.showMessageBox({ type: 'warning', message: 'Esa carpeta no tiene un archivo .env', detail: dir, buttons: ['Elegir otra'] });
        continue;
      }
      saveDataDir(dir);
      return dir;
    }

    // Nueva: en Documentos, con las reglas de ejemplo y un .env para llenar
    const dir = path.join(app.getPath('documents'), APP_NAME);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    const copy = (from, to) => { if (!fs.existsSync(to) && fs.existsSync(from)) fs.copyFileSync(from, to); };
    copy(path.join(ROOT, '.env.example'), path.join(dir, '.env'));
    copy(path.join(ROOT, 'config', 'rules.json'), path.join(dir, 'config', 'rules.json'));
    saveDataDir(dir);
    await dialog.showMessageBox({
      type: 'info', message: 'Llena tu archivo .env',
      detail: `Creé la carpeta:\n${dir}\n\nAbre el archivo .env, llena tus datos de Twitch y Minecraft y vuelve a abrir la app.`,
      buttons: ['Abrir la carpeta']
    });
    shell.openPath(dir);
    return null;
  }
}

// "Iniciar con Windows" guarda la ruta del programa; si una actualización cambia el nombre del .exe,
// se vuelve a registrar al abrir para que siga funcionando.
const PREFS_FILE = () => path.join(app.getPath('userData'), 'preferencias.json');
function readPrefs() { try { return JSON.parse(fs.readFileSync(PREFS_FILE(), 'utf8')); } catch { return {}; } }
function setAutostart(on) {
  app.setLoginItemSettings({ openAtLogin: on, args: ['--oculto'] });
  try { fs.writeFileSync(PREFS_FILE(), JSON.stringify({ ...readPrefs(), autostart: on }, null, 2)); } catch { /* no es grave */ }
}
function refreshAutostart() {
  if (!app.isPackaged) return;
  const prefs = readPrefs();
  const on = prefs.autostart ?? app.getLoginItemSettings().openAtLogin;
  if (on) setAutostart(true);
}

function saveDataDir(dir) {
  fs.mkdirSync(path.dirname(LOCATION_FILE()), { recursive: true });
  fs.writeFileSync(LOCATION_FILE(), JSON.stringify({ dataDir: dir }, null, 2));
}

async function changeDataDir() {
  const { response } = await dialog.showMessageBox({
    type: 'question', message: '¿Cambiar la carpeta de datos?',
    detail: `Ahora: ${DATA_DIR}\n\nLa app se reiniciará y te preguntará cuál usar. No se borra ni se mueve nada.`,
    buttons: ['Cambiar', 'Cancelar'], defaultId: 0, cancelId: 1, noLink: true
  });
  if (response !== 0) return;
  fs.rmSync(LOCATION_FILE(), { force: true });
  app.relaunch();
  app.quit();
}

// ---------- Utilidades ----------

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(ASSETS, 'icon.png'), silent: true });
  n.on('click', showWindow); // clic en la notificación → abrir el panel
  n.show();
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
  // Si hay una versión descargada, se instala al salir (en silencio). Con el botón, además, se vuelve a abrir.
  if (update.state === 'ready') {
    autoUpdater.quitAndInstall(true, installOnQuit === 'restart');
    return;
  }
  app.exit(0);
});

app.on('window-all-closed', () => { /* seguimos en la bandeja */ });

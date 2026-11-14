import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { log } from './core/logger.js';

/**
 * Abre Playit.gg al iniciar la app (solo Windows).
 *
 * Playit 2.x se instala en "C:\Program Files\playit_gg\bin" con tres programas:
 *   playitd.exe       → el que mantiene el túnel (el importante)
 *   playitd-tray.exe  → el icono de la bandeja
 *   playit-gui.exe    → la ventana
 * Si playitd ya está corriendo no se hace nada. Si no, se abre el icono de la bandeja
 * (no tapa el juego) y, si el túnel no arranca con eso, la ventana.
 * Al cerrar la app Playit se queda abierto para que el túnel no se caiga.
 */
const DAEMON = 'playitd.exe';
const LAUNCHERS = ['playitd-tray.exe', 'playit-gui.exe', 'playit.exe'];

function binDirs(customPath) {
  const env = process.env;
  const dirs = [];
  if (customPath) dirs.push(/\.exe$/i.test(customPath) ? path.dirname(customPath) : customPath);
  if (env.ProgramFiles) dirs.push(path.join(env.ProgramFiles, 'playit_gg', 'bin'));
  if (env['ProgramFiles(x86)']) dirs.push(path.join(env['ProgramFiles(x86)'], 'playit_gg', 'bin'));
  if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Programs', 'playit_gg', 'bin'));
  return dirs;
}

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Programas para abrir Playit, en orden de preferencia. */
export function findPlayit(customPath) {
  const list = [];
  if (customPath && /\.exe$/i.test(customPath) && exists(customPath)) list.push(customPath);
  for (const dir of binDirs(customPath)) {
    for (const name of LAUNCHERS) {
      const p = path.join(dir, name);
      if (exists(p) && !list.includes(p)) list.push(p);
    }
  }
  return list;
}

function isRunning(image) {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], { windowsHide: true }, (err, out) => {
      resolve(!err && out.toLowerCase().includes(image.toLowerCase()));
    });
  });
}

const tunnelRunning = async () => (await isRunning(DAEMON)) || (await isRunning('playit.exe'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(exe) {
  const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
  child.on('error', (err) => log.error(`Playit: no se pudo abrir ${path.basename(exe)} (${err.message})`));
  child.unref();
}

export async function startPlayit({ enabled, customPath }) {
  if (!enabled || process.platform !== 'win32') return;
  if (await tunnelRunning()) { log.info('Playit ya estaba corriendo.'); return; }

  const launchers = findPlayit(customPath);
  if (launchers.length === 0) {
    log.warn('Playit: no lo encontré. Pon la carpeta donde está instalado en PLAYIT_PATH dentro de tu .env (por ejemplo C:\\Program Files\\playit_gg\\bin).');
    return;
  }

  for (const exe of launchers) {
    launch(exe);
    for (let i = 0; i < 8; i++) {
      await wait(1000);
      if (await tunnelRunning()) { log.info(`Playit abierto (${path.basename(exe)}): tu servidor ya se puede alcanzar desde fuera de tu casa.`); return; }
    }
  }
  log.warn('Playit: lo abrí, pero el túnel no arrancó. Ábrelo a mano y revisa que esté "Connected to playit".');
}

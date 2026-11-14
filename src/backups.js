import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { log } from './core/logger.js';
import { readServerProperties } from './minecraftPlayers.js';

/**
 * Respaldos del mundo de la instalación activa, en .zip con fecha.
 *
 * - Automáticos cada N horas mientras el servidor está encendido, y al detenerlo.
 * - En caliente sin riesgo: save-off → save-all flush → copiar → save-on.
 * - Se conservan los últimos N automáticos; los manuales y los "antes de restaurar" no se borran solos.
 * - Restaurar solo con el servidor apagado, y antes se respalda el mundo actual.
 *
 * Los .zip se hacen con el tar.exe que trae Windows 10/11, así no hace falta instalar nada.
 */
const httpError = (status, message) => Object.assign(new Error(message), { status });
const FILE = /^[\w.-]+\.zip$/;
const REASONS = { auto: 'Automático', 'al-detener': 'Al detener', manual: 'Manual', 'antes-de-restaurar': 'Antes de restaurar' };
const AUTOMATIC = new Set(['auto', 'al-detener']);
const EXTRA_FILES = ['server.properties', 'whitelist.json', 'ops.json', 'banned-players.json', 'banned-ips.json', 'usercache.json'];
const DEFAULTS = { enabled: true, intervalHours: 2, onStop: true, keep: 10, dir: '' };

function tarBinary() {
  if (process.platform === 'win32') return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return 'bsdtar';
}

function runTar(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(tarBinary(), args, { cwd, windowsHide: true });
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? 'No encontré tar.exe (viene con Windows 10/11).' : e.message)));
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar terminó con código ${code}: ${err.trim().split('\n').slice(-2).join(' ')}`))));
  });
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

/** Carpetas del mundo según level-name (Paper/Spigot separan el Nether y el End). */
export function worldFolders(dir) {
  const level = readServerProperties(dir)['level-name'] || 'world';
  return [level, `${level}_nether`, `${level}_the_end`].filter((f) => {
    try { return fs.statSync(path.join(dir, f)).isDirectory(); } catch { return false; }
  });
}

export class BackupManager {
  constructor({ file, mcServer, mc, getInstallation }) {
    this.file = file;
    this.mcServer = mcServer;
    this.mc = mc;
    this.getInstallation = getInstallation; // () => { id, name, dir } de la activa
    this.settings = { ...DEFAULTS };
    try { this.settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* primera vez */ }
    this.busy = null;      // { kind: 'backup' | 'restore', reason, since }
    this.restorePending = false;
    this.current = null;   // promesa del trabajo en curso
    this.lastError = null;
    this.timer = setInterval(() => this.#tick(), 60 * 1000);
    this.timer.unref?.();

    // Al detener el servidor (no al reiniciar ni si se cae)
    mcServer.onStopped = () => {
      if (this.settings.enabled && this.settings.onStop) this.backup('al-detener').catch(() => {});
    };
    // No dejar arrancar mientras se restaura o se copia un mundo apagado
    mcServer.startGuard = () => {
      if (this.busy?.kind === 'restore' || this.restorePending) return 'Se está restaurando un respaldo. Espera a que termine.';
      if (this.busy?.kind === 'backup' && !['running', 'starting'].includes(this.mcServer.state)) return 'Se está guardando un respaldo. Espera unos segundos.';
      return null;
    };
  }

  dispose() { clearInterval(this.timer); }

  /** Espera a que termine el respaldo en curso (al cerrar la app). */
  async whenIdle() { try { await this.current; } catch { /* ya se registró */ } }

  #saveSettings() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.settings, null, 2));
  }

  updateSettings(raw = {}) {
    const s = { ...this.settings };
    if (raw.enabled !== undefined) s.enabled = Boolean(raw.enabled);
    if (raw.onStop !== undefined) s.onStop = Boolean(raw.onStop);
    if (raw.intervalHours !== undefined) {
      const h = Number(raw.intervalHours);
      if (!(h >= 0.25 && h <= 48)) throw httpError(400, 'El intervalo va de 0.25 a 48 horas');
      s.intervalHours = h;
    }
    if (raw.keep !== undefined) {
      const k = Math.round(Number(raw.keep));
      if (!(k >= 1 && k <= 200)) throw httpError(400, 'Conserva entre 1 y 200 respaldos automáticos');
      s.keep = k;
    }
    if (raw.dir !== undefined) {
      const d = String(raw.dir ?? '').trim().replace(/^"|"$/g, '');
      if (d) {
        try { fs.mkdirSync(d, { recursive: true }); } catch (e) { throw httpError(400, `No pude usar esa carpeta: ${e.message}`); }
      }
      s.dir = d ? path.resolve(d) : '';
    }
    this.settings = s;
    this.#saveSettings();
    return this.status();
  }

  /** Carpeta de respaldos de una instalación: <carpeta elegida o mc-backups junto al servidor>\<id>. */
  folderFor(inst) {
    const base = this.settings.dir || path.join(path.dirname(inst.dir), 'mc-backups');
    return path.join(base, inst.id);
  }

  list(inst = this.getInstallation()) {
    if (!inst) return [];
    const folder = this.folderFor(inst);
    let names = [];
    try { names = fs.readdirSync(folder).filter((f) => FILE.test(f)); } catch { return []; }
    return names.map((file) => {
      const st = fs.statSync(path.join(folder, file));
      const reason = /_([a-z-]+)\.zip$/.exec(file)?.[1] ?? 'manual';
      return { file, size: st.size, at: st.mtime.toISOString(), reason, reasonLabel: REASONS[reason] ?? reason };
    }).sort((a, b) => b.at.localeCompare(a.at));
  }

  status() {
    const inst = this.getInstallation();
    const list = this.list(inst);
    const lastAt = list[0]?.at ?? null;
    let nextAt = null;
    if (this.settings.enabled && inst && this.mcServer.state === 'running') {
      const from = Math.max(lastAt ? Date.parse(lastAt) : 0, this.mcServer.startedAt ? Date.parse(this.mcServer.startedAt) : 0);
      nextAt = new Date(from + this.settings.intervalHours * 3600e3).toISOString();
    }
    return {
      settings: this.settings,
      installation: inst ? { id: inst.id, name: inst.name } : null,
      folder: inst ? this.folderFor(inst) : null,
      list, busy: this.busy, lastError: this.lastError, nextAt,
      totalSize: list.reduce((n, b) => n + b.size, 0)
    };
  }

  #tick() {
    if (!this.settings.enabled || this.busy || this.mcServer.state !== 'running') return;
    const next = this.status().nextAt;
    if (next && Date.now() >= Date.parse(next)) this.backup('auto').catch(() => {});
  }

  /** Manda un comando por RCON o, si no hay RCON, por la consola del servidor. */
  async #command(cmd) {
    if (this.mc.connected) return this.mc.send(cmd);
    if (this.mcServer.proc) { this.mcServer.send(cmd); return ''; }
    throw httpError(409, 'No hay forma de hablar con el servidor (ni RCON ni consola)');
  }

  /** save-all flush puede tardar más que el tiempo de espera de RCON: también se escucha la consola. */
  async #flush() {
    let seen = false;
    const unsubscribe = this.mcServer.subscribe((e) => { if (/Saved the game/i.test(e.text)) seen = true; });
    try {
      let response = '';
      try { response = await this.#command('save-all flush'); } catch { /* tardó más que RCON; seguimos esperando la consola */ }
      if (/Saved the game/i.test(response ?? '')) return;
      const owned = Boolean(this.mcServer.proc);
      const until = Date.now() + (owned ? 120e3 : 15e3);
      while (!seen && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
      if (owned && !seen) throw new Error('El servidor no terminó de guardar a tiempo');
    } finally { unsubscribe(); }
  }

  backup(reason = 'manual') {
    if (this.busy) return Promise.reject(httpError(409, this.busy.kind === 'restore' ? 'Se está restaurando un respaldo' : 'Ya se está haciendo un respaldo'));
    const inst = this.getInstallation();
    if (!inst) return Promise.reject(httpError(400, 'No hay una instalación activa'));
    const worlds = worldFolders(inst.dir);
    if (worlds.length === 0) return Promise.reject(httpError(400, 'Esta instalación todavía no tiene mundo (se crea la primera vez que inicias el servidor)'));

    this.busy = { kind: 'backup', reason, since: new Date().toISOString() };
    this.current = this.#backup(inst, worlds, reason).finally(() => { this.busy = null; });
    return this.current;
  }

  async #backup(inst, worlds, reason) {
    const state = this.mcServer.state;
    const live = ['running', 'external'].includes(state) || (state === 'starting' && this.mcServer.proc);
    if (state === 'external' && !this.mc.connected) throw httpError(409, 'El servidor corre fuera de la app y no hay RCON: no puedo pausar el guardado para respaldar sin riesgo');
    if (state === 'stopping') throw httpError(409, 'El servidor se está deteniendo; el respaldo al detener se hará solo');

    const folder = this.folderFor(inst);
    fs.mkdirSync(folder, { recursive: true });
    let name = `${stamp()}_${reason}.zip`;
    for (let n = 2; fs.existsSync(path.join(folder, name)); n++) name = `${stamp()}-${n}_${reason}.zip`;
    const part = path.join(folder, `${name}.part`);
    const started = Date.now();
    log.info(`💾 Respaldando "${inst.name}" (${REASONS[reason] ?? reason})…`);

    let savingOff = false;
    try {
      if (live) {
        await this.#command('save-off');
        savingOff = true;
        await this.#flush();
      }
      const files = EXTRA_FILES.filter((f) => fs.existsSync(path.join(inst.dir, f)));
      await runTar(['-a', '-c', '-f', part, '--exclude', 'session.lock', '-C', inst.dir, ...worlds, ...files], inst.dir);
      // tar decide el formato por la extensión: se crea como .zip y luego se le quita el ".part"
      fs.renameSync(part, path.join(folder, name));
    } catch (err) {
      fs.rmSync(part, { force: true });
      this.lastError = { at: new Date().toISOString(), message: err.message };
      log.error(`💾 No se pudo respaldar: ${err.message}`);
      throw err;
    } finally {
      if (savingOff) await this.#command('save-on').catch((e) => log.error(`No se pudo reactivar el guardado (save-on): ${e.message}. Escríbelo en la consola.`));
    }

    this.lastError = null;
    const size = fs.statSync(path.join(folder, name)).size;
    log.info(`💾 Respaldo listo: ${name} (${(size / 1048576).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
    this.#prune(inst);
    return { file: name, size };
  }

  /** Conserva solo los últimos N respaldos automáticos. */
  #prune(inst) {
    const auto = this.list(inst).filter((b) => AUTOMATIC.has(b.reason));
    for (const old of auto.slice(this.settings.keep)) {
      try { fs.rmSync(path.join(this.folderFor(inst), old.file)); log.info(`💾 Respaldo viejo borrado: ${old.file}`); } catch { /* en uso */ }
    }
  }

  #resolve(file) {
    const inst = this.getInstallation();
    if (!inst) throw httpError(400, 'No hay una instalación activa');
    if (!FILE.test(String(file ?? ''))) throw httpError(400, 'Nombre de respaldo inválido');
    const full = path.join(this.folderFor(inst), file);
    if (!fs.existsSync(full)) throw httpError(404, 'Ese respaldo ya no existe');
    return { inst, full };
  }

  remove(file) {
    if (this.busy) throw httpError(409, 'Espera a que termine el respaldo o la restauración en curso');
    const { full } = this.#resolve(file);
    fs.rmSync(full);
    return this.status();
  }

  restore(file) {
    if (this.busy) return Promise.reject(httpError(409, 'Espera a que termine el respaldo en curso'));
    if (!['stopped', 'crashed'].includes(this.mcServer.state) || this.mcServer.proc) {
      return Promise.reject(httpError(409, 'Detén el servidor antes de restaurar un respaldo'));
    }
    let resolved;
    try { resolved = this.#resolve(file); } catch (e) { return Promise.reject(e); }
    const run = async () => {
      this.restorePending = true; // que nadie arranque el servidor entre la copia y la restauración
      try {
        // 1) Copia de lo que hay ahora, por si acaso
        if (worldFolders(resolved.inst.dir).length) await this.backup('antes-de-restaurar');
        this.busy = { kind: 'restore', file, since: new Date().toISOString() };
        await this.#restore(resolved.inst, resolved.full, file);
      } finally { this.busy = null; this.restorePending = false; }
    };
    this.current = run();
    return this.current;
  }

  async #restore(inst, full, file) {
    const tmp = path.join(inst.dir, `.restaurando-${Date.now()}`);
    log.info(`💾 Restaurando ${file} en "${inst.name}"…`);
    fs.mkdirSync(tmp);
    try {
      await runTar(['-x', '-f', full, '-C', tmp], tmp);
      const level = readServerProperties(inst.dir)['level-name'] || 'world';
      const restored = fs.readdirSync(tmp).filter((f) => fs.statSync(path.join(tmp, f)).isDirectory()
        && [level, `${level}_nether`, `${level}_the_end`].includes(f));
      if (restored.length === 0) throw httpError(400, `Ese respaldo no tiene el mundo "${level}". ¿Cambiaste level-name en server.properties?`);
      // Solo se reemplazan las carpetas del mundo; la lista blanca y la configuración actuales se quedan
      for (const f of [level, `${level}_nether`, `${level}_the_end`]) {
        if (!restored.includes(f)) continue;
        fs.rmSync(path.join(inst.dir, f), { recursive: true, force: true });
        fs.renameSync(path.join(tmp, f), path.join(inst.dir, f));
      }
      log.info(`💾 Mundo restaurado desde ${file}`);
    } catch (err) {
      this.lastError = { at: new Date().toISOString(), message: err.message };
      log.error(`💾 No se pudo restaurar: ${err.message}`);
      throw err;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './core/logger.js';

const MAX_LINES = 1000;
const ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;

/**
 * Arranca y controla el servidor de Minecraft (Paper) como proceso hijo:
 * consola en vivo, comandos por stdin, apagado limpio con "stop"
 * y reinicio automático si se cae (igual que el start.bat).
 *
 * Estados: stopped | starting | running | stopping | crashed | external
 */
export class MinecraftServer {
  constructor({ dir, java = 'java', memoryMin = '2G', memoryMax = '4G', extraArgs = '', autoRestart = true, onRconReady }) {
    this.dir = dir;
    this.java = java;
    this.memoryMin = memoryMin;
    this.memoryMax = memoryMax;
    this.extraArgs = extraArgs;
    this.autoRestart = autoRestart;
    this.onRconReady = onRconReady;
    this.proc = null;
    this.state = 'stopped';
    this.startedAt = null;
    this.lines = [];
    this.subscribers = new Set();
    this.nextId = 1;
    this.stopRequested = false;
    this.crashes = [];
    this.restartTimer = null;
  }

  get configured() {
    return Boolean(this.dir);
  }

  get jarPath() {
    if (!this.dir) return null;
    try {
      const jars = fs.readdirSync(this.dir).filter((f) => f.toLowerCase().endsWith('.jar'));
      const jar = jars.find((f) => f.toLowerCase() === 'paper.jar') ?? jars.find((f) => /paper/i.test(f)) ?? jars[0];
      return jar ? path.join(this.dir, jar) : null;
    } catch {
      return null;
    }
  }

  status() {
    return {
      configured: this.configured,
      dir: this.dir,
      state: this.state,
      startedAt: this.startedAt,
      pid: this.proc?.pid ?? null,
      autoRestart: this.autoRestart
    };
  }

  /** Marca que hay un servidor corriendo que NO arrancó la app (ej. con start.bat). */
  markExternal(isRunning) {
    if (this.proc) return;
    if (isRunning && this.state === 'stopped') this.state = 'external';
    if (!isRunning && this.state === 'external') this.state = 'stopped';
  }

  start() {
    if (!this.configured) throw httpError(400, 'Configura MC_SERVER_DIR en el .env con la carpeta del servidor');
    if (this.proc) throw httpError(409, 'El servidor ya está corriendo');
    if (this.state === 'external') throw httpError(409, 'Ya hay un servidor corriendo fuera de la app (¿start.bat?). Ciérralo primero.');
    const jar = this.jarPath;
    if (!jar) throw httpError(400, `No encontré ningún .jar en ${this.dir}`);

    clearTimeout(this.restartTimer);
    this.stopRequested = false;
    const args = [
      `-Xms${this.memoryMin}`,
      `-Xmx${this.memoryMax}`,
      '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-Dfile.encoding=UTF-8',
      ...this.extraArgs.split(/\s+/).filter(Boolean),
      '-jar', path.basename(jar), 'nogui'
    ];

    this.#push('app', `▶ Iniciando: ${this.java} ${args.join(' ')}`);
    this.state = 'starting';
    this.startedAt = new Date().toISOString();

    const proc = spawn(this.java, args, { cwd: this.dir, windowsHide: true });
    this.proc = proc;

    const onData = (stream) => {
      let buffer = '';
      return (chunk) => {
        buffer += chunk.toString('utf8');
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop();
        for (const raw of parts) this.#onLine(raw.replace(ANSI, ''), stream);
      };
    };
    proc.stdout.on('data', onData('out'));
    proc.stderr.on('data', onData('err'));

    proc.on('error', (err) => {
      const msg = err.code === 'ENOENT' ? `No se encontró "${this.java}". ¿Está Java instalado y en el PATH? (o define MC_JAVA en el .env)` : err.message;
      this.#push('app', `❌ ${msg}`);
      log.error(`Servidor de Minecraft: ${msg}`);
    });

    proc.on('exit', (code, signal) => this.#onExit(code, signal));
    log.info('⛏️  Iniciando servidor de Minecraft…');
  }

  /** Apaga con "stop" (guarda el mundo). Si no responde en `timeoutMs`, lo fuerza. */
  async stop({ timeoutMs = 45000 } = {}) {
    clearTimeout(this.restartTimer);
    if (!this.proc) {
      if (this.state === 'crashed') this.state = 'stopped';
      return;
    }
    this.stopRequested = true;
    this.state = 'stopping';
    this.#push('app', '■ Deteniendo servidor (guardando el mundo)…');
    const proc = this.proc;
    const exited = new Promise((resolve) => proc.once('exit', resolve));
    try { proc.stdin.write('stop\n'); } catch { /* el proceso ya no acepta comandos */ }
    const timer = setTimeout(() => {
      this.#push('app', '⚠️ No respondió a tiempo, forzando cierre');
      proc.kill();
    }, timeoutMs);
    await exited;
    clearTimeout(timer);
  }

  async restart() {
    await this.stop();
    this.start();
  }

  /** Manda un comando a la consola del servidor (solo si lo arrancó la app). */
  send(command) {
    if (!this.proc || this.state === 'stopping') throw httpError(409, 'El servidor no está corriendo desde la app');
    const clean = String(command).replace(/[\r\n]/g, ' ').trim().replace(/^\//, '');
    if (!clean) throw httpError(400, 'Escribe un comando');
    this.#push('in', `> ${clean}`);
    this.proc.stdin.write(`${clean}\n`);
  }

  history() {
    return [...this.lines];
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  #onLine(text, stream) {
    if (!text.trim() || /^>\s*$/.test(text)) return;
    this.#push(stream, text);
    if (this.state === 'starting' && /Done \([\d.,]+s\)! For help/.test(text)) {
      this.state = 'running';
      log.info('⛏️  Servidor de Minecraft listo');
    }
    if (/RCON running on/.test(text)) {
      // Darle un momento a que RCON acepte conexiones
      setTimeout(() => this.onRconReady?.(), 1000);
    }
  }

  #onExit(code, signal) {
    const requested = this.stopRequested;
    this.proc = null;
    this.#push('app', `■ El servidor terminó (código ${code ?? signal})`);

    if (requested || code === 0) {
      this.state = 'stopped';
      log.info('⛏️  Servidor de Minecraft detenido');
      return;
    }

    this.state = 'crashed';
    log.error(`El servidor de Minecraft se cayó (código ${code ?? signal})`);

    // Evitar un bucle infinito si crashea al arrancar: máximo 3 reinicios en 5 minutos
    const now = Date.now();
    this.crashes = this.crashes.filter((t) => now - t < 5 * 60 * 1000).concat(now);
    if (!this.autoRestart) return;
    if (this.crashes.length > 3) {
      this.#push('app', '⚠️ Se cayó demasiadas veces seguidas; no se reiniciará solo. Revisa la consola.');
      log.warn('El servidor se cayó más de 3 veces en 5 minutos; reinicio automático desactivado por ahora');
      return;
    }
    this.#push('app', '↻ Reiniciando en 10 segundos…');
    this.restartTimer = setTimeout(() => {
      try { this.start(); } catch (err) { this.#push('app', `❌ ${err.message}`); }
    }, 10000);
  }

  #push(stream, text) {
    const entry = { id: this.nextId++, at: new Date().toISOString(), stream, text };
    this.lines.push(entry);
    if (this.lines.length > MAX_LINES) this.lines.shift();
    for (const fn of this.subscribers) {
      try { fn(entry); } catch { /* ignorar suscriptores caídos */ }
    }
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

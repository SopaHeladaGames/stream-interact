import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './core/logger.js';
import { detectInstallation, prepareInstallation, readRconPassword } from './installations.js';

const MAX_LINES = 1000;
const ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;

/**
 * Arranca y controla el servidor de Minecraft (Paper, Vanilla, Fabric, NeoForge o Forge) como proceso hijo:
 * consola en vivo, comandos por stdin, apagado limpio con "stop"
 * y reinicio automático si se cae (igual que el start.bat).
 *
 * Estados: stopped | starting | running | stopping | crashed | external
 */
export class MinecraftServer {
  constructor({ dir, java = 'java', memoryMin = '2G', memoryMax = '4G', extraArgs = '', autoRestart = true, onRconReady, rcon }) {
    this.dir = dir;
    this.installation = null; // { id, name } de la instalación activa
    this.rcon = rcon;         // { port, password } para dejar server.properties listo
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
    this.restarting = false;
    this.onStopped = null;   // se llama al detenerlo a propósito (no al reiniciar ni si se cae)
    this.startGuard = null;  // () => motivo para no dejar arrancar, o null
  }

  get configured() {
    return Boolean(this.dir);
  }

  /** Cambia la instalación que se arranca (solo con el servidor apagado). */
  setInstallation(inst) {
    if (this.proc) throw httpError(409, 'Detén el servidor antes de cambiar de instalación');
    if (this.state === 'external') throw httpError(409, 'Hay un servidor corriendo fuera de la app. Ciérralo antes de cambiar de instalación.');
    clearTimeout(this.restartTimer);
    this.dir = inst.dir;
    this.java = inst.java;
    this.memoryMin = inst.memoryMin;
    this.memoryMax = inst.memoryMax;
    this.extraArgs = inst.extraArgs ?? '';
    this.installation = { id: inst.id, name: inst.name };
    this.crashes = [];
    if (this.state === 'crashed') this.state = 'stopped';
  }

  status() {
    return {
      configured: this.configured,
      dir: this.dir,
      installation: this.installation,
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
    if (!this.configured) throw httpError(400, 'Agrega una instalación del servidor en la página Instalaciones');
    if (this.proc) throw httpError(409, 'El servidor ya está corriendo');
    if (this.state === 'external') throw httpError(409, 'Ya hay un servidor corriendo fuera de la app (¿start.bat?). Ciérralo primero.');
    const blocked = this.startGuard?.();
    if (blocked) throw httpError(409, blocked);
    const info = detectInstallation(this.dir);
    if (!info.exists) throw httpError(400, `No existe la carpeta ${this.dir}`);
    if (!info.launch) throw httpError(400, `No encontré un servidor en ${this.dir} (ni un .jar ni una instalación de NeoForge/Forge)`);
    if (!info.eula) throw httpError(400, 'Falta aceptar el EULA de Minecraft en esta instalación (en la página Instalaciones → Editar).');
    if (this.rcon) prepareInstallation(this.dir, { rconPort: this.rcon.port, rconPassword: this.rcon.password });

    clearTimeout(this.restartTimer);
    this.stopRequested = false;
    const memory = [`-Xms${this.memoryMin}`, `-Xmx${this.memoryMax}`];
    const common = ['-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-Dfile.encoding=UTF-8', ...this.extraArgs.split(/\s+/).filter(Boolean)];
    let args;
    if (info.launch.kind === 'args') {
      // Igual que el run.bat de NeoForge/Forge; la memoria va después de user_jvm_args.txt para que gane la del panel
      const userArgs = fs.existsSync(path.join(this.dir, 'user_jvm_args.txt')) ? ['@user_jvm_args.txt'] : [];
      args = [...userArgs, ...memory, ...common, `@${info.launch.args}`, 'nogui'];
    } else {
      args = [...memory, ...common, '-jar', info.launch.jar, 'nogui'];
    }
    this.#push('app', `▶ Iniciando ${this.installation?.name ?? 'servidor'} (${info.label}${info.version ? ` ${info.version}` : ''}): ${this.java} ${args.join(' ')}`);
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
      const msg = err.code === 'ENOENT' ? `No se encontró "${this.java}". ¿Está Java instalado y en el PATH? (o elige su java.exe en la página Instalaciones)` : err.message;
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
    this.restarting = true;
    try { await this.stop(); } finally { this.restarting = false; }
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
      const pass = this.rcon ? readRconPassword(this.dir) : null;
      if (pass !== null && pass !== this.rcon.password) {
        const msg = 'La contraseña de RCON en server.properties no coincide con MC_RCON_PASSWORD del .env: el panel no podrá conectarse. Detén el servidor y vuelve a iniciarlo desde la app.';
        this.#push('app', `⚠️ ${msg}`);
        log.warn(msg);
      }
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
      if (!this.restarting) { try { this.onStopped?.(); } catch { /* no bloquear el apagado */ } }
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

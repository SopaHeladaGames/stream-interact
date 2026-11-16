import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { log } from './core/logger.js';
import { detectInstallation } from './installations.js';

/**
 * Actualiza el .jar de Paper de una instalación con la API oficial de PaperMC (Fill v3).
 * Solo cambia de build dentro de la MISMA versión de Minecraft (ej. 26.3 build 248 → 253):
 * eso no toca el mundo. Subir de versión de Minecraft (26.3 → 26.4) solo se avisa, porque
 * convierte el mundo y no se puede deshacer.
 */
const API = 'https://fill.papermc.io/v3/projects/paper';
const USER_AGENT = 'Sopa-ChatBot (https://github.com/SopaHeladaGames/stream-interact)';
const CACHE_MS = 10 * 60e3;
const httpError = (status, message) => Object.assign(new Error(message), { status });

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw httpError(502, `No pude conectar con PaperMC (${err.cause?.code ?? err.message}). ¿Hay internet?`);
  }
  if (res.status === 404) throw httpError(404, 'PaperMC no tiene builds para esa versión de Minecraft');
  if (!res.ok) throw httpError(502, `PaperMC respondió ${res.status}`);
  return res.json();
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

/** Lo que Paper anotó la última vez que arrancó: "26.3-248-0727243 (MC: 26.3)". */
function readVersionHistory(dir) {
  for (const file of [path.join(dir, '.paper', 'version_history.json'), path.join(dir, 'version_history.json')]) {
    try {
      const current = JSON.parse(fs.readFileSync(file, 'utf8')).currentVersion ?? '';
      const mc = /\(MC: ([^)]+)\)/.exec(current)?.[1] ?? null;
      const build = Number(/^[^-\s]+-(\d+)-/.exec(current)?.[1]) || Number(/git-Paper-(\d+)/.exec(current)?.[1]) || null;
      if (mc) return { mc, build };
    } catch { /* sigue con el otro */ }
  }
  return null;
}

const compareVersions = (a, b) => {
  const pa = a.split(/[.-]/).map((n) => parseInt(n) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

const download = (build) => build?.downloads?.['server:default'] ?? Object.values(build?.downloads ?? {})[0] ?? null;

export class PaperUpdater {
  constructor({ installations, mcServer }) {
    this.installations = installations;
    this.mcServer = mcServer;
    this.cache = new Map(); // id → { at, result }
    this.job = null;        // { id, phase, received, total, error, done }
  }

  #paperJar(item) {
    const info = detectInstallation(item.dir);
    if (info.type !== 'paper' || info.launch?.kind !== 'jar') throw httpError(400, 'Esta instalación no usa Paper');
    return { info, jar: path.join(item.dir, info.launch.jar), jarName: info.launch.jar };
  }

  /** Versión instalada, la última disponible y cuántos builds va atrás. */
  async check(id, { force = false } = {}) {
    const item = this.installations.get(id);
    const cached = this.cache.get(id);
    if (!force && cached && Date.now() - cached.at < CACHE_MS) return { ...cached.result, job: this.#jobFor(id) };

    const { info, jar, jarName } = this.#paperJar(item);
    const history = readVersionHistory(item.dir);
    const mc = history?.mc ?? info.version;
    if (!mc) throw httpError(400, 'No sé qué versión de Minecraft usa esta instalación. Inicia el servidor una vez y vuelve a revisar.');

    const [builds, project, hash] = await Promise.all([
      getJson(`${API}/versions/${encodeURIComponent(mc)}/builds`),
      getJson(API).catch(() => null),
      sha256File(jar)
    ]);
    if (!Array.isArray(builds) || builds.length === 0) throw httpError(404, `PaperMC no tiene builds para Minecraft ${mc}`);
    builds.sort((a, b) => b.id - a.id);

    // El build instalado: por el hash del .jar (exacto); si no aparece, lo que anotó Paper al arrancar
    const byHash = builds.find((b) => download(b)?.checksums?.sha256?.toLowerCase() === hash);
    const currentBuild = byHash?.id ?? history?.build ?? null;
    const current = builds.find((b) => b.id === currentBuild) ?? null;

    // Recomendamos el último estable; si esta versión aún no tiene estables, el último que haya
    const stable = builds.filter((b) => b.channel === 'STABLE');
    const latest = (stable.length ? stable : builds)[0];
    const behind = currentBuild ? builds.filter((b) => b.id > currentBuild && (stable.length ? b.channel === 'STABLE' : true)).length : null;

    const allVersions = project?.versions ? Object.values(project.versions).flat().filter((v) => /^\d+(\.\d+)*$/.test(v)) : [];
    const newerMc = allVersions.filter((v) => compareVersions(v, mc) > 0).sort(compareVersions).reverse();

    const result = {
      id, mc, jar: jarName,
      current: currentBuild ? { build: currentBuild, channel: current?.channel ?? null, time: current?.time ?? null, exact: Boolean(byHash) } : null,
      latest: { build: latest.id, channel: latest.channel, time: latest.time, size: download(latest)?.size ?? null },
      behind,
      upToDate: currentBuild !== null && currentBuild >= latest.id,
      changes: currentBuild
        ? builds.filter((b) => b.id > currentBuild && b.id <= latest.id).flatMap((b) => (b.commits ?? []).map((c) => ({ build: b.id, message: String(c.message ?? '').split('\n')[0] }))).slice(0, 15)
        : [],
      newerMc: newerMc[0] ?? null,
      hasPrevious: fs.existsSync(`${jar}.anterior`),
      checkedAt: new Date().toISOString()
    };
    this.cache.set(id, { at: Date.now(), result });
    return { ...result, job: this.#jobFor(id) };
  }

  #jobFor(id) {
    return this.job && this.job.id === id ? { ...this.job } : null;
  }

  status(id) {
    return this.#jobFor(id);
  }

  #isActiveRunning(id) {
    return this.installations.data.active === id && ['starting', 'running', 'stopping', 'external'].includes(this.mcServer.state);
  }

  /** Descarga el último build, lo verifica y reemplaza el .jar (guardando el anterior). */
  update(id) {
    if (this.job && !this.job.done) throw httpError(409, 'Ya se está actualizando Paper');
    const item = this.installations.get(id);
    if (this.installations.data.active === id && this.mcServer.state === 'external') {
      throw httpError(409, 'El servidor corre fuera de la app (¿start.bat?). Ciérralo y vuelve a intentarlo.');
    }
    this.job = { id, phase: 'buscando', received: 0, total: null, error: null, done: false, restarted: false };
    this.#run(item).catch((err) => {
      log.error('No se pudo actualizar Paper:', err.message);
      Object.assign(this.job, { phase: 'error', error: err.message, done: true });
    });
    return { ...this.job };
  }

  async #run(item) {
    const job = this.job;
    const { jar } = this.#paperJar(item);
    const info = await this.check(item.id, { force: true });
    if (info.upToDate) { Object.assign(job, { phase: 'al-dia', done: true }); return; }

    const builds = await getJson(`${API}/versions/${encodeURIComponent(info.mc)}/builds`);
    const target = builds.find((b) => b.id === info.latest.build);
    const file = download(target);
    if (!file?.url) throw new Error('PaperMC no dio un enlace de descarga para ese build');

    // 1) Descargar a un archivo aparte (el servidor sigue corriendo mientras tanto)
    job.phase = 'descargando';
    job.total = file.size ?? null;
    const tmp = `${jar}.descarga`;
    let res;
    try {
      res = await fetch(file.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(5 * 60e3) });
    } catch (err) { throw new Error(`No pude descargar Paper (${err.cause?.code ?? err.message})`); }
    if (!res.ok || !res.body) throw new Error(`La descarga respondió ${res.status}`);
    job.total = Number(res.headers.get('content-length')) || job.total;
    const hash = crypto.createHash('sha256');
    const body = Readable.fromWeb(res.body);
    body.on('data', (d) => { hash.update(d); job.received += d.length; });
    await pipeline(body, fs.createWriteStream(tmp));

    // 2) Verificar que llegó completo y sin alterar
    job.phase = 'verificando';
    const expected = file.checksums?.sha256?.toLowerCase();
    if (expected && hash.digest('hex') !== expected) {
      fs.rmSync(tmp, { force: true });
      throw new Error('El archivo descargado no coincide con el de PaperMC (se descartó). Intenta de nuevo.');
    }

    // 3) Si esta instalación está encendida, apagarla un momento
    const wasRunning = this.#isActiveRunning(item.id);
    if (wasRunning) {
      job.phase = 'deteniendo';
      this.mcServer.restarting = true; // como un reinicio: sin respaldo al detener
      try { await this.mcServer.stop(); } finally { this.mcServer.restarting = false; }
    }

    // 4) Cambiar el .jar, guardando el anterior por si hay que regresar
    job.phase = 'reemplazando';
    fs.rmSync(`${jar}.anterior`, { force: true });
    fs.renameSync(jar, `${jar}.anterior`);
    fs.renameSync(tmp, jar);
    log.info(`⬆️  Paper de "${item.name}" actualizado: build ${info.current?.build ?? '?'} → ${info.latest.build} (Minecraft ${info.mc})`);

    if (wasRunning) {
      job.phase = 'iniciando';
      this.mcServer.start();
      job.restarted = true;
    }
    this.cache.delete(item.id);
    Object.assign(job, { phase: 'listo', done: true, from: info.current?.build ?? null, to: info.latest.build });
  }

  /** Regresa al .jar anterior (el que quedó como paper.jar.anterior). */
  async revert(id) {
    if (this.job && !this.job.done) throw httpError(409, 'Espera a que termine la actualización');
    const item = this.installations.get(id);
    const { jar } = this.#paperJar(item);
    if (!fs.existsSync(`${jar}.anterior`)) throw httpError(404, 'No hay una versión anterior guardada');
    if (this.#isActiveRunning(id)) throw httpError(409, 'Detén el servidor antes de regresar a la versión anterior');
    const swap = `${jar}.cambio`;
    fs.renameSync(jar, swap);
    fs.renameSync(`${jar}.anterior`, jar);
    fs.renameSync(swap, `${jar}.anterior`);
    this.cache.delete(id);
    log.info(`↩️  Paper de "${item.name}" regresó a la versión anterior`);
    return this.check(id, { force: true });
  }
}

import fs from 'node:fs';
import path from 'node:path';

/**
 * Historial de lo que hizo el chat: un archivo por mes en data/historial/AAAA-MM.jsonl
 * (una línea JSON por interacción, fácil de abrir o de importar en Excel).
 *
 * Cada registro: { at, status, platform, type, rule, label, user, userId, target, amount, currency, input, test }
 *   status: ok | error | cooldown | rechazada | pausa | sin-regla
 *
 * Los "directos" se calculan solos: si pasan más de 2 horas sin actividad, empieza uno nuevo.
 */
const SESSION_GAP = 2 * 3600e3;
const httpError = (status, message) => Object.assign(new Error(message), { status });

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export class HistoryStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cache = new Map(); // mes → registros (el mes actual se mantiene al día en memoria)
  }

  record(entry) {
    const at = new Date();
    const rec = { at: at.toISOString(), ...entry };
    const key = monthKey(at);
    try {
      fs.appendFileSync(path.join(this.dir, `${key}.jsonl`), `${JSON.stringify(rec)}\n`);
      if (this.cache.has(key)) this.cache.get(key).push(rec);
    } catch { /* el historial nunca debe frenar el juego */ }
  }

  #month(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    let list = [];
    try {
      list = fs.readFileSync(path.join(this.dir, `${key}.jsonl`), 'utf8').split('\n')
        .filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { /* mes sin datos */ }
    this.cache.set(key, list);
    return list;
  }

  months() {
    try { return fs.readdirSync(this.dir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 7)).sort(); } catch { return []; }
  }

  /** Registros entre dos fechas (ms), en orden. */
  between(from, to = Date.now()) {
    const out = [];
    for (const key of this.months()) {
      const [y, m] = key.split('-').map(Number);
      const start = new Date(y, m - 1, 1).getTime();
      const end = new Date(y, m, 1).getTime();
      if (end < from || start > to) continue;
      for (const r of this.#month(key)) {
        const t = Date.parse(r.at);
        if (t >= from && t <= to) out.push(r);
      }
    }
    return out;
  }

  /** Directos detectados por huecos de actividad (los más recientes primero). */
  sessions(limit = 30) {
    const all = this.between(Date.now() - 120 * 86400e3).filter((r) => !r.test);
    const sessions = [];
    for (const r of all) {
      const t = Date.parse(r.at);
      const last = sessions[sessions.length - 1];
      if (last && t - last.end <= SESSION_GAP) { last.end = t; last.count++; }
      else sessions.push({ start: t, end: t, count: 1 });
    }
    return sessions.reverse().slice(0, limit).map((s) => ({ ...s, start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() }));
  }

  /** Rango a partir de lo que pide el panel. */
  range({ range = 'session', from, to } = {}) {
    const now = Date.now();
    if (range === 'custom') {
      const f = Date.parse(from); const t = Date.parse(to);
      if (!Number.isFinite(f) || !Number.isFinite(t)) throw httpError(400, 'Fechas inválidas');
      return { from: f, to: t };
    }
    if (range === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return { from: d.getTime(), to: now }; }
    if (range === '7d') return { from: now - 7 * 86400e3, to: now };
    if (range === '30d') return { from: now - 30 * 86400e3, to: now };
    if (range === 'all') return { from: 0, to: now };
    // Último directo (si el último registro fue hace poco, sigue siendo "este directo")
    const s = this.sessions(1)[0];
    return s ? { from: Date.parse(s.start), to: Math.max(now, Date.parse(s.end)) } : { from: now, to: now };
  }

  /** Resumen para el panel. */
  stats({ range, from, to, tests = false } = {}) {
    const r = this.range({ range, from, to });
    const recs = this.between(r.from, r.to).filter((x) => tests || !x.test);
    const done = recs.filter((x) => x.status === 'ok');

    const viewers = new Map();
    const rules = new Map();
    const targets = new Map();
    const money = {};
    let bits = 0;
    const byType = {};
    const byStatus = {};
    for (const x of recs) {
      byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
      // Dinero y bits cuentan aunque no hubiera regla (nunca se pierde un apoyo)
      if (x.type === 'cheer' && (x.status === 'ok' || x.status === 'sin-regla' || x.status === 'error')) bits += x.amount ?? 0;
      if (x.type === 'donation' && (x.status === 'ok' || x.status === 'sin-regla' || x.status === 'error')) money[x.currency || '?'] = (money[x.currency || '?'] ?? 0) + (x.amount ?? 0);
      const isViewer = !['caos', 'votacion'].includes(x.platform);
      if (isViewer && x.user) {
        // Por nombre: así se juntan las donaciones (Streamlabs, Ko-fi…) con lo que hizo en Twitch
        const vk = x.user.toLowerCase();
        const v = viewers.get(vk) ?? { user: x.user, platform: x.platform, count: 0, bits: 0, money: {} };
        if (x.status === 'ok' || x.status === 'sin-regla') v.count++;
        if (x.type === 'cheer') v.bits += x.amount ?? 0;
        if (x.type === 'donation') v.money[x.currency || '?'] = (v.money[x.currency || '?'] ?? 0) + (x.amount ?? 0);
        viewers.set(vk, v);
      }
    }
    for (const x of done) {
      byType[x.type] = (byType[x.type] ?? 0) + 1;
      const k = x.rule ?? x.label;
      const ru = rules.get(k) ?? { rule: x.rule, label: x.label ?? x.rule, count: 0 };
      ru.count++; rules.set(k, ru);
      if (x.target) targets.set(x.target, (targets.get(x.target) ?? 0) + 1);
    }

    const span = r.to - r.from;
    const bucket = span <= 6 * 3600e3 ? 10 * 60e3 : span <= 2 * 86400e3 ? 3600e3 : 86400e3;
    const timeline = [];
    if (recs.length) {
      const first = Math.floor(Math.max(r.from, Date.parse(recs[0].at)) / bucket) * bucket;
      const last = Math.min(r.to, Date.now());
      const counts = new Map();
      for (const x of done) { const b = Math.floor(Date.parse(x.at) / bucket) * bucket; counts.set(b, (counts.get(b) ?? 0) + 1); }
      for (let t = first; t <= last && timeline.length < 400; t += bucket) timeline.push({ t: new Date(t).toISOString(), count: counts.get(t) ?? 0 });
    }

    return {
      from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString(), bucketMs: bucket,
      totals: {
        interactions: done.length,
        viewers: [...viewers.values()].filter((v) => v.count > 0).length,
        bits, money,
        rejected: (byStatus.cooldown ?? 0) + (byStatus.rechazada ?? 0) + (byStatus.pausa ?? 0),
        failed: byStatus.error ?? 0
      },
      byType, byStatus,
      topViewers: [...viewers.values()].filter((v) => v.count > 0 || v.bits || Object.keys(v.money).length)
        .sort((a, b) => b.count - a.count || b.bits - a.bits).slice(0, 15),
      topBits: [...viewers.values()].filter((v) => v.bits > 0).sort((a, b) => b.bits - a.bits).slice(0, 10),
      topRules: [...rules.values()].sort((a, b) => b.count - a.count).slice(0, 15),
      targets: [...targets.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      timeline,
      recent: recs.slice(-200).reverse(),
      sessions: this.sessions(20)
    };
  }

  /** CSV para Excel (separado por comas, con BOM para que abra bien los acentos). */
  csv(opts = {}) {
    const r = this.range(opts);
    const recs = this.between(r.from, r.to).filter((x) => opts.tests || !x.test);
    const cols = ['at', 'status', 'platform', 'type', 'label', 'user', 'target', 'amount', 'currency', 'input'];
    const head = ['fecha', 'resultado', 'plataforma', 'tipo', 'regla', 'usuario', 'objetivo', 'monto', 'moneda', 'texto'];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = recs.map((x) => cols.map((c) => esc(c === 'at' ? new Date(x.at).toLocaleString('es-MX', { hour12: false }) : x[c])).join(','));
    return `﻿${head.join(',')}\n${rows.join('\n')}\n`;
  }
}

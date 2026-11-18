/**
 * Compatibilidad de comandos entre versiones de Minecraft.
 *
 * Las reglas se escriben con la sintaxis actual (26.x). Si la instalación activa es más vieja
 * (por ejemplo un mundo con mods en 1.21.1), cada comando se traduce justo antes de mandarlo:
 *
 *  - Antes de 1.21.5 los textos de los NBT (CustomName…) eran JSON entre comillas:
 *      CustomName:{text:"Ana",color:"gold"}  →  CustomName:'{"text":"Ana","color":"gold"}'
 *  - Antes de 1.21.5 el equipo de los mobs iba en listas:
 *      equipment:{head:…,mainhand:…}         →  ArmorItems:[pies,piernas,pecho,cabeza],HandItems:[principal,secundaria]
 *      drop_chances:{head:0f,…}              →  ArmorDropChances:[…],HandDropChances:[…]
 *  - Antes de 1.21.11 las reglas del mundo eran camelCase (keep_inventory → keepInventory).
 */
import fs from 'node:fs';
import path from 'node:path';
import { GAMERULES } from './gamerules.js';
import { detectInstallation } from './installations.js';

export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Versión de Minecraft a partir de lo que detectó detectInstallation(). */
export function gameVersionOf(info) {
  if (!info) return null;
  if (info.mcVersion) return info.mcVersion;
  const v = info.version;
  if (!v) return null;
  if (info.type === 'neoforge') {
    // NeoForge 21.1.267 → Minecraft 1.21.1 · NeoForge 26.3.x → Minecraft 26.3
    const [major, minor] = v.split(/[.-]/).map((n) => parseInt(n) || 0);
    if (major >= 26) return minor ? `${major}.${minor}` : `${major}`;
    return minor ? `1.${major}.${minor}` : `1.${major}`;
  }
  if (info.type === 'forge') return v.split('-')[0];
  return v;
}

/** Versión de Minecraft de la carpeta de una instalación (se guarda unos segundos para no leer disco en cada comando). */
const versionCache = new Map(); // dir → { at, version }
export function gameVersionOfDir(dir) {
  if (!dir) return null;
  const hit = versionCache.get(dir);
  if (hit && Date.now() - hit.at < 30e3) return hit.version;
  const info = detectInstallation(dir);
  let version = gameVersionOf(info);
  if (info.type === 'paper' || info.type === 'purpur') {
    // Paper anota la versión real al arrancar: "26.3-253-abc (MC: 26.3)"
    try {
      const h = JSON.parse(fs.readFileSync(path.join(dir, '.paper', 'version_history.json'), 'utf8')).currentVersion ?? '';
      version = /\(MC: ([^)]+)\)/.exec(h)?.[1] ?? version;
    } catch { /* aún no ha arrancado */ }
  }
  versionCache.set(dir, { at: Date.now(), version });
  return version;
}

// ---------- SNBT → JSON (para los textos de antes de 1.21.5) ----------

/** Lee un valor SNBT empezando en s[i]. Devuelve { value, end }. Solo lo necesario para textos. */
function readSnbt(s, i) {
  const skip = () => { while (/\s/.test(s[i])) i++; };
  skip();
  const c = s[i];
  if (c === '{') {
    i++; const obj = {};
    skip();
    if (s[i] === '}') return { value: obj, end: i + 1 };
    for (;;) {
      skip();
      let key;
      if (s[i] === '"' || s[i] === "'") { const r = readString(s, i); key = r.value; i = r.end; }
      else { const m = /^[\w.+-]+/.exec(s.slice(i)); if (!m) throw new Error('clave'); key = m[0]; i += key.length; }
      skip(); if (s[i] !== ':') throw new Error('dos puntos'); i++;
      const r = readSnbt(s, i); obj[key] = r.value; i = r.end;
      skip();
      if (s[i] === ',') { i++; continue; }
      if (s[i] === '}') return { value: obj, end: i + 1 };
      throw new Error('objeto');
    }
  }
  if (c === '[') {
    i++; const arr = [];
    skip();
    if (s[i] === ']') return { value: arr, end: i + 1 };
    for (;;) {
      const r = readSnbt(s, i); arr.push(r.value); i = r.end;
      skip();
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ']') return { value: arr, end: i + 1 };
      throw new Error('lista');
    }
  }
  if (c === '"' || c === "'") return readString(s, i);
  const m = /^[^,}\]\s]+/.exec(s.slice(i));
  if (!m) throw new Error('valor');
  const raw = m[0];
  let value = raw;
  if (/^(true|1b)$/i.test(raw)) value = true;
  else if (/^(false|0b)$/i.test(raw)) value = false;
  else if (/^-?\d+(\.\d+)?[bsilfd]?$/i.test(raw)) value = Number(raw.replace(/[bsilfd]$/i, ''));
  return { value, end: i + raw.length };
}

function readString(s, i) {
  const q = s[i]; let out = ''; i++;
  while (i < s.length && s[i] !== q) {
    if (s[i] === '\\') { out += s[i + 1] ?? ''; i += 2; continue; }
    out += s[i++];
  }
  return { value: out, end: i + 1 };
}

/** Posición donde termina el valor que empieza en s[i] ({…}, […] o texto), respetando comillas. */
function valueEnd(s, i) {
  let depth = 0; let quote = null;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (quote) { if (ch === '\\') { j++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { if (depth === 0) return j; depth--; if (depth === 0) return j + 1; }
    else if ((ch === ',' || /\s/.test(ch)) && depth === 0) return j;
  }
  return s.length;
}

/**
 * Reemplaza cada `clave:{…}` (en cualquier nivel) con lo que devuelva fn(textoDelValor).
 * whole: true si fn devuelve la pareja completa (otra clave); si no, solo el valor nuevo.
 */
function replaceKey(s, key, fn, { whole = false } = {}) {
  const re = new RegExp(`(^|[{,\\s])${key}\\s*:\\s*`, 'g');
  let out = ''; let last = 0; let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[1].length;
    const valStart = m.index + m[0].length;
    const end = valueEnd(s, valStart);
    const replacement = fn(s.slice(valStart, end));
    if (replacement === null) continue;
    out += s.slice(last, whole ? start : valStart) + replacement;
    last = end;
    re.lastIndex = end;
  }
  return out + s.slice(last);
}

const jsonText = (snbt) => {
  const trimmed = snbt.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"')) return null;
  try {
    const value = readSnbt(trimmed, 0).value;
    return `'${JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  } catch { return null; }
};

const ARMOR = ['feet', 'legs', 'chest', 'head'];
const HANDS = ['mainhand', 'offhand'];

function legacyEquipment(cmd) {
  cmd = replaceKey(cmd, 'equipment', (snbt) => {
    let eq;
    try { eq = readSnbt(snbt.trim(), 0).value; } catch { return null; }
    if (typeof eq !== 'object' || Array.isArray(eq)) return null;
    // Se reconstruyen los objetos como SNBT a partir del texto original de cada uno
    const parts = splitTopLevel(snbt.trim().slice(1, -1));
    const item = (slot) => parts[slot] ?? '{}';
    const out = [];
    if (ARMOR.some((s) => parts[s])) out.push(`ArmorItems:[${ARMOR.map(item).join(',')}]`);
    if (HANDS.some((s) => parts[s])) out.push(`HandItems:[${HANDS.map(item).join(',')}]`);
    return out.join(',') || null;
  }, { whole: true });
  cmd = replaceKey(cmd, 'drop_chances', (snbt) => {
    const parts = splitTopLevel(snbt.trim().slice(1, -1));
    const chance = (slot) => parts[slot] ?? '0.085f';
    const out = [];
    if (ARMOR.some((s) => parts[s])) out.push(`ArmorDropChances:[${ARMOR.map(chance).join(',')}]`);
    if (HANDS.some((s) => parts[s])) out.push(`HandDropChances:[${HANDS.map(chance).join(',')}]`);
    return out.join(',') || null;
  }, { whole: true });
  return cmd;
}

/** "head:{…},mainhand:{…}" → { head: "{…}", mainhand: "{…}" } (texto SNBT tal cual). */
function splitTopLevel(body) {
  const out = {};
  let i = 0;
  while (i < body.length) {
    while (/[\s,]/.test(body[i] ?? '')) i++;
    const m = /^([\w.+-]+)\s*:\s*/.exec(body.slice(i));
    if (!m) break;
    const start = i + m[0].length;
    const end = valueEnd(body, start);
    out[m[1]] = body.slice(start, end).trim();
    i = end;
  }
  return out;
}

const LEGACY_RULES = new Map(GAMERULES.filter((r) => r.legacy).map((r) => [r.id, r.legacy]));

/** Traduce un comando escrito con la sintaxis actual a la de `version` (si hace falta). */
export function adaptCommand(command, version) {
  if (!version) return command;
  let cmd = command;
  if (compareVersions(version, '1.21.5') < 0) {
    cmd = replaceKey(cmd, 'CustomName', jsonText);
    cmd = legacyEquipment(cmd);
  }
  if (compareVersions(version, '1.21.11') < 0) {
    cmd = cmd.replace(/(^|\brun\s+)gamerule\s+([a-z_]+)/g, (m, pre, name) => (LEGACY_RULES.has(name) ? `${pre}gamerule ${LEGACY_RULES.get(name)}` : m));
  }
  return cmd;
}

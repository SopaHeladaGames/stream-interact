import fs from 'node:fs';
import { GAMERULES } from '../gamerules.js';

export const TRIGGER_TYPES = ['reward', 'command', 'cheer', 'donation', 'sub', 'gift', 'raid', 'follow'];
export const TARGETS = ['me', 'chat', 'random', 'all'];

/**
 * Lee y guarda config/rules.json validando su contenido,
 * para que el panel no pueda dejar un archivo roto.
 */
export class RulesStore {
  constructor(rulesPath, actionTypes) {
    this.rulesPath = rulesPath;
    this.actionTypes = actionTypes;
  }

  read() {
    return JSON.parse(fs.readFileSync(this.rulesPath, 'utf8'));
  }

  /** Valida y guarda { settings, rules }. Lanza Error con un mensaje claro si algo está mal. */
  write({ settings, rules }) {
    rules = normalize(rules);
    const errors = this.validate(rules);
    if (errors.length) {
      const err = new Error(errors.join(' · '));
      err.status = 400;
      throw err;
    }
    let current = {};
    try { current = this.read(); } catch { /* si el archivo está roto, se reemplaza */ }
    const data = {
      ...(current._ayuda ? { _ayuda: current._ayuda } : {}),
      settings: { ...(current.settings ?? {}), ...(settings ?? {}) },
      rules
    };
    const tmp = `${this.rulesPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, this.rulesPath);
    return data;
  }

  validate(rules) {
    const errors = [];
    if (!Array.isArray(rules)) return ['"rules" debe ser una lista'];
    const ids = new Set();
    rules.forEach((rule, i) => {
      const label = rule?.id ? `Regla "${rule.id}"` : `Regla #${i + 1}`;
      if (!rule || typeof rule !== 'object') return errors.push(`${label}: formato inválido`);
      if (!rule.id || typeof rule.id !== 'string') errors.push(`${label}: falta el id`);
      else if (ids.has(rule.id)) errors.push(`${label}: id repetido`);
      else ids.add(rule.id);

      const t = rule.trigger;
      if (!t || !TRIGGER_TYPES.includes(t.type)) errors.push(`${label}: tipo de disparador inválido`);
      else if ((t.type === 'reward' || t.type === 'command') && !t.name) errors.push(`${label}: falta el nombre del disparador`);
      else if (t.type === 'command' && !t.name.startsWith('!')) errors.push(`${label}: los comandos deben empezar con "!"`);

      if (rule.target != null && !TARGETS.includes(rule.target)) errors.push(`${label}: objetivo "${rule.target}" inválido`);
      if (rule.maxPerStream != null && !(Number.isInteger(rule.maxPerStream) && rule.maxPerStream >= 1)) errors.push(`${label}: el máximo por directo debe ser un número entero ≥ 1`);

      for (const key of ['cooldownMs', 'userCooldownMs']) {
        if (rule[key] != null && (!Number.isFinite(rule[key]) || rule[key] < 0)) errors.push(`${label}: ${key} debe ser un número ≥ 0`);
      }

      if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
        errors.push(`${label}: necesita al menos una acción`);
      } else {
        rule.actions.forEach((a, j) => {
          if (!this.actionTypes.includes(a?.type)) errors.push(`${label}, acción ${j + 1}: tipo "${a?.type}" desconocido`);
          if (a?.type === 'minecraft' && a.repeat != null && !(Number(a.repeat) >= 1 && Number(a.repeat) <= 100)) errors.push(`${label}, acción ${j + 1}: repetir va de 1 a 100`);
          if (a?.type === 'caos' && !(Number(a.seconds) >= 10 && Number(a.seconds) <= 7200)) errors.push(`${label}, acción ${j + 1}: el modo caos dura de 10 a 7200 segundos`);
          if (a?.type === 'gamerule') {
            const gr = GAMERULES.find((r) => r.id === a.rule);
            if (!gr) errors.push(`${label}, acción ${j + 1}: elige una regla del mundo`);
            else if (gr.type === 'int' && !(Number(a.value) >= gr.min && Number(a.value) <= gr.max)) errors.push(`${label}, acción ${j + 1}: el valor debe ir de ${gr.min} a ${gr.max}`);
            if (a.seconds != null && !(Number(a.seconds) >= 0 && Number(a.seconds) <= 86400)) errors.push(`${label}, acción ${j + 1}: la duración va de 0 a 86400 segundos`);
          }
          if (a?.type === 'minecraft' && (!Array.isArray(a.commands) || !a.commands.some((c) => c.trim()))) {
            errors.push(`${label}, acción ${j + 1}: escribe al menos un comando`);
          }
        });
      }
    });
    return errors;
  }
}

/** Limpia lo que deja el formulario: líneas vacías y campos sin valor. */
function normalize(rules) {
  if (!Array.isArray(rules)) return rules;
  return JSON.parse(JSON.stringify(rules)).map(({ target, ...rule }) => ({
    ...rule,
    ...(target && target !== 'me' ? { target } : {}),
    actions: (rule.actions ?? []).map((a) =>
      a.type === 'minecraft' ? { ...a, commands: (a.commands ?? []).map((c) => c.trim()).filter(Boolean) } : a)
  }));
}

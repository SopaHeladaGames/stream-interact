import fs from 'node:fs';
import path from 'node:path';

const httpError = (status, message) => Object.assign(new Error(message), { status });

// Lo que trae la app la primera vez (usa las reglas de ejemplo "zombie" y "creeper")
const DEFAULTS = {
  polls: [
    {
      id: 'zombie-o-creeper',
      question: '¿Zombie o creeper?',
      duration: 30,
      onNoVotes: 'nothing',
      options: [
        { label: 'Zombie', ruleId: 'zombie' },
        { label: 'Creeper', ruleId: 'creeper' }
      ]
    }
  ],
  chaos: { minSeconds: 120, maxSeconds: 300, ruleIds: [] }
};

/** Valida una votación y la devuelve limpia. Lanza un Error con mensaje claro si algo falta. */
export function normalizePoll(p) {
  const question = String(p?.question ?? '').trim();
  if (!question) throw httpError(400, 'La votación necesita una pregunta');
  const label = `La votación "${question}"`;

  const duration = Math.round(Number(p.duration));
  if (!(duration >= 10 && duration <= 600)) throw httpError(400, `${label}: la duración debe estar entre 10 y 600 segundos`);

  const options = (Array.isArray(p.options) ? p.options : []).map((o) => ({
    label: String(o?.label ?? '').trim().slice(0, 40),
    ruleId: String(o?.ruleId ?? '')
  }));
  if (options.length < 2 || options.length > 5) throw httpError(400, `${label}: debe tener entre 2 y 5 opciones`);
  options.forEach((o, i) => {
    if (!o.ruleId) throw httpError(400, `${label}: elige una regla para la opción ${i + 1}`);
    if (!o.label) throw httpError(400, `${label}: ponle nombre a la opción ${i + 1}`);
  });

  return {
    id: String(p.id || `votacion-${Date.now().toString(36)}`),
    question: question.slice(0, 120),
    duration,
    onNoVotes: p.onNoVotes === 'random' ? 'random' : 'nothing',
    options
  };
}

function normalizeChaos(c) {
  const minSeconds = Math.round(Number(c?.minSeconds));
  const maxSeconds = Math.round(Number(c?.maxSeconds));
  if (!(minSeconds >= 15)) throw httpError(400, 'El intervalo mínimo debe ser de al menos 15 segundos');
  if (!(maxSeconds >= minSeconds)) throw httpError(400, 'El intervalo máximo no puede ser menor que el mínimo');
  if (maxSeconds > 3600) throw httpError(400, 'El intervalo máximo es de 3600 segundos (1 hora)');
  const ruleIds = [...new Set((Array.isArray(c.ruleIds) ? c.ruleIds : []).map(String))];
  return { minSeconds, maxSeconds, ruleIds };
}

/**
 * Guarda las votaciones y la configuración del modo caos en config/juego.json
 * (aparte de rules.json, para no mezclar).
 */
export class GameStore {
  constructor(file) {
    this.file = file;
    this.data = this.#read();
  }

  get polls() { return this.data.polls; }
  get chaos() { return this.data.chaos; }

  savePolls(polls) {
    if (!Array.isArray(polls)) throw httpError(400, 'Formato inválido');
    const clean = polls.map(normalizePoll);
    const ids = new Set();
    for (const p of clean) {
      while (ids.has(p.id)) p.id = `${p.id}-2`;
      ids.add(p.id);
    }
    this.data.polls = clean;
    this.#write();
    return clean;
  }

  saveChaos(chaos) {
    this.data.chaos = normalizeChaos(chaos);
    this.#write();
    return this.data.chaos;
  }

  #read() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { polls: Array.isArray(d.polls) ? d.polls : [], chaos: { ...DEFAULTS.chaos, ...(d.chaos ?? {}) } };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  #write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n');
    fs.renameSync(tmp, this.file);
  }
}

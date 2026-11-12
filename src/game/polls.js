import { log } from '../core/logger.js';
import { chatFeed } from '../core/chatFeed.js';
import { normalizePoll } from './gameStore.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * Votaciones del chat: el chat escribe 1, 2, 3… (o !1, !2…) y la opción
 * con más votos ejecuta una regla. Solo puede haber una votación a la vez.
 */
export class PollManager {
  constructor({ bus, engine, store, notify }) {
    this.bus = bus;
    this.engine = engine;
    this.store = store;
    this.notify = notify; // { chat(text), minecraft(text, platform, color), title(title, subtitle, color) }
    this.active = null;
    this.last = null;

    // Votos escritos en el chat como número suelto ("2") o como comando ("!2")
    this.unsubscribe = chatFeed.subscribe((e) => {
      if (e.kind !== 'message' || !this.active) return;
      const m = /^!?([1-9])$/.exec((e.text ?? '').trim());
      if (m) this.vote({ id: `${e.platform}:${e.user.id}`, name: e.user.displayName }, Number(m[1]));
    });
    bus.onEvent((event) => this.#onBusEvent(event));
  }

  #onBusEvent(event) {
    if (event.type !== 'command') return;
    const m = /^!([1-9])$/.exec(event.name);
    if (m) {
      this.vote({ id: `${event.platform}:${event.user.id}`, name: event.user.displayName }, Number(m[1]));
      return;
    }
    // !votacion [nombre] / !votacion cancelar — solo streamer y mods
    if (event.name !== '!votacion' || !(event.user.isMod || event.user.isBroadcaster)) return;
    const arg = (event.input ?? '').trim().toLowerCase();
    try {
      if (arg === 'cancelar') { this.finish('cancelled'); return; }
      const presets = this.store.polls;
      const preset = arg
        ? presets.find((p) => p.id.toLowerCase() === arg || p.question.toLowerCase().includes(arg))
        : presets[0];
      if (!preset) throw new Error(arg ? `No encontré una votación que coincida con "${arg}"` : 'No hay votaciones guardadas');
      this.start(preset);
    } catch (err) {
      this.notify.chat(`📊 ${err.message}`);
    }
  }

  /** Inicia una votación. `def` es { question, duration, options: [{ label, ruleId }], onNoVotes }. */
  start(def) {
    if (this.active) throw httpError(409, 'Ya hay una votación en curso');
    if (this.bus.paused) throw httpError(409, 'Las interacciones están en pausa. Reanúdalas para iniciar una votación.');
    const poll = normalizePoll(def);
    for (const o of poll.options) {
      if (!this.engine.hasRule(o.ruleId)) {
        throw httpError(400, `La opción "${o.label}" usa una regla que no existe o está desactivada`);
      }
    }

    const now = Date.now();
    this.active = {
      ...poll,
      votes: new Map(), // id del votante -> índice de la opción
      startedAt: now,
      endsAt: now + poll.duration * 1000,
      timer: setTimeout(() => this.finish('time'), poll.duration * 1000)
    };

    const list = poll.options.map((o, i) => `${i + 1}) ${o.label}`).join('   ');
    this.notify.chat(`📊 VOTACIÓN: ${poll.question}   ${list}   — Escribe el número en el chat. Tienen ${poll.duration}s.`);
    this.notify.title('¡Votación!', poll.question, 'gold');
    this.notify.minecraft(`${poll.question}  ${list}`, 'votacion', 'gold');
    log.info(`📊 Votación iniciada: ${poll.question} (${poll.duration}s)`);
    return this.status();
  }

  /** Registra (o cambia) el voto de alguien. Devuelve false si no hay votación o la opción no existe. */
  vote(voter, optionNumber) {
    const poll = this.active;
    if (!poll || !(optionNumber >= 1 && optionNumber <= poll.options.length)) return false;
    poll.votes.set(voter.id, optionNumber - 1);
    return true;
  }

  /** Termina la votación. reason: 'time' | 'manual' | 'cancelled'. */
  finish(reason = 'manual') {
    const poll = this.active;
    if (!poll) return null;
    clearTimeout(poll.timer);
    this.active = null;

    const counts = this.#counts(poll);
    const total = counts.reduce((a, b) => a + b, 0);
    let winner = null;
    let executed = false;

    if (reason === 'cancelled') {
      this.notify.chat('📊 Votación cancelada.');
    } else {
      if (total > 0) {
        const max = Math.max(...counts);
        winner = pick(counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0)); // empate: al azar
      } else if (poll.onNoVotes === 'random') {
        winner = Math.floor(Math.random() * poll.options.length);
      }

      if (winner === null) {
        this.notify.chat('📊 Nadie votó, así que no pasa nada.');
        this.notify.minecraft('Nadie votó', 'votacion', 'gray');
      } else {
        const option = poll.options[winner];
        const detail = total > 0
          ? `con ${counts[winner]} de ${total} voto${total === 1 ? '' : 's'}`
          : 'al azar, porque nadie votó';
        this.notify.chat(`🏆 Ganó "${option.label}" ${detail}.`);
        this.notify.minecraft(`Ganó: ${option.label}`, 'votacion', 'gold');
        executed = this.engine.runRule(option.ruleId, {
          platform: 'votacion',
          chatPlatform: 'twitch',
          type: 'poll',
          name: poll.question,
          user: { id: 'votacion', name: 'chat', displayName: 'El chat', isMod: false, isBroadcaster: false },
          amount: counts[winner],
          input: ''
        });
      }
    }

    this.last = {
      id: poll.id,
      question: poll.question,
      options: poll.options.map((o, i) => ({ ...o, votes: counts[i] })),
      total,
      winner,
      executed,
      reason,
      endedAt: new Date().toISOString()
    };
    log.info(`📊 Votación terminada: ${poll.question} → ${winner === null ? 'sin ganador' : poll.options[winner].label}`);
    return this.last;
  }

  status() {
    const poll = this.active;
    if (!poll) return { active: null, last: this.last };
    const counts = this.#counts(poll);
    return {
      active: {
        id: poll.id,
        question: poll.question,
        duration: poll.duration,
        options: poll.options.map((o, i) => ({ ...o, votes: counts[i] })),
        total: poll.votes.size,
        endsAt: new Date(poll.endsAt).toISOString(),
        remainingMs: Math.max(0, poll.endsAt - Date.now())
      },
      last: this.last
    };
  }

  /** Resumen ligero para /api/estado. */
  summary() {
    return { active: Boolean(this.active), lastEndedAt: this.last?.endedAt ?? null };
  }

  dispose() {
    if (this.active) clearTimeout(this.active.timer);
    this.active = null;
    this.unsubscribe();
  }

  #counts(poll) {
    const counts = poll.options.map(() => 0);
    for (const index of poll.votes.values()) counts[index]++;
    return counts;
  }
}

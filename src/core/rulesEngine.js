import fs from 'node:fs';
import { log } from './logger.js';
import { formatMoney } from './money.js';

/**
 * Lee config/rules.json y decide qué acciones ejecutar para cada evento.
 * Se recarga solo cuando guardas el archivo (no necesitas reiniciar).
 */
export class RulesEngine {
  constructor({ rulesPath, bus, actions, context, targets }) {
    this.rulesPath = rulesPath;
    this.bus = bus;
    this.actions = actions;   // { minecraft: fn, chat: fn, ... }
    this.context = context;   // variables fijas, ej. { player }
    this.targets = targets;   // PlayerTargets: a quién le llega cada regla ({target})
    this.rules = [];
    this.settings = {};
    this.lastRun = new Map();       // ruleKey -> timestamp
    this.lastRunByUser = new Map(); // `${ruleKey}:${userId}` -> timestamp
    this.warned = new Map();        // `${ruleKey}:${userId}` -> hasta cuándo ya se avisó
    this.lastHelp = 0;
    this.runListeners = new Set();
    this.recordListeners = new Set(); // historial / estadísticas
    this.load();
    fs.watchFile(rulesPath, { interval: 1000 }, () => this.load());
    bus.onEvent((event) => this.handle(event));
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.rulesPath, 'utf8'));
      this.rules = (data.rules ?? []).filter((r) => r.enabled !== false);
      this.settings = {
        cooldownReplies: true,
        helpCommand: '!comandos',
        helpCooldownMs: 30000,
        pauseRewards: true,
        ...(data.settings ?? {})
      };
      log.info(`📜 ${this.rules.length} reglas cargadas desde ${this.rulesPath}`);
    } catch (err) {
      log.error(`No se pudo leer ${this.rulesPath} (se mantienen las reglas anteriores):`, err.message);
    }
  }

  /** Responde en el chat de la plataforma de donde vino el evento. */
  async reply(event, message) {
    const chat = this.actions.chat;
    if (!chat) return;
    await chat({ message }, { user: event.user.displayName }, event).catch(() => {});
  }

  async handle(event) {
    if (event.type === 'command') {
      // Comandos de control para ti y tus mods: !pausa / !reanudar
      if (event.user.isBroadcaster || event.user.isMod) {
        if (event.name === '!pausa') return this.bus.pause();
        if (event.name === '!reanudar') return this.bus.resume();
      }
      if (event.name === this.settings.helpCommand) return this.help(event);
    }

    const rule = this.rules.find((r) => matches(r.trigger, event));
    if (!rule) {
      // Bits y donaciones se guardan aunque no tengan regla (para las estadísticas)
      if (event.type === 'cheer' || event.type === 'donation') this.#record(event, null, 'sin-regla');
      return;
    }

    const now = Date.now();
    const ruleKey = rule.id ?? rule.trigger.name ?? JSON.stringify(rule.trigger);
    const userKey = `${ruleKey}:${event.user.id}`;
    const cooldownLeft = (rule.cooldownMs ?? 0) - (now - (this.lastRun.get(ruleKey) ?? 0));
    const userCooldownLeft = (rule.userCooldownMs ?? 0) - (now - (this.lastRunByUser.get(userKey) ?? 0));
    // Una donación es dinero real: nunca se descarta por cooldown
    const waitMs = event.type === 'donation' ? 0 : Math.max(cooldownLeft, userCooldownLeft);

    if (waitMs > 0) {
      const secs = Math.ceil(waitMs / 1000);
      log.warn(`"${ruleKey}" en cooldown (${secs}s) para ${event.user.displayName}`);
      const refunded = event.refund ? await event.refund().then(() => true, () => false) : false;
      this.#record(event, rule, 'cooldown', { refunded });
      await this.warnCooldown(event, userKey, now + waitMs, secs, refunded);
      return;
    }

    // ¿A quién le toca? Si el espectador eligió a alguien que no está, se le avisa y se devuelven los puntos
    let target = null;
    if (rule.target === 'chat' && this.targets) {
      const strict = event.type === 'reward' || event.type === 'command';
      target = await this.targets.resolve('chat', event.input, { strict });
      if (target.error) {
        log.warn(`"${ruleKey}" de ${event.user.displayName}: ${target.error}`);
        const refunded = event.refund ? await event.refund().then(() => true, () => false) : false;
        this.#record(event, rule, 'rechazada', { refunded, reason: target.error });
        await this.reply(event, `@${event.user.name} ${target.error}${refunded ? ' Te devolví tus puntos.' : ''}`);
        return;
      }
    }

    const accepted = this.enqueueRule(rule, event, ruleKey, target);

    if (accepted) {
      this.lastRun.set(ruleKey, now);
      this.lastRunByUser.set(userKey, now);
    } else {
      await event.refund?.().catch(() => {});
    }
  }

  /** Pone en la cola las acciones de una regla. Devuelve false si la cola la rechazó (pausa o llena). */
  enqueueRule(rule, event, ruleKey, target = null, mode = null) {
    const vars = {
      ...this.context,
      user: safe(event.user.displayName),
      input: safe(event.input),
      amount: String(event.amount ?? 0),
      currency: event.currency ?? '',
      money: event.type === 'donation' ? formatMoney(event.amount, event.currency) : String(event.amount ?? 0),
      platform: event.platform
    };

    const accepted = this.bus.enqueue(ruleKey, async () => {
      // Al azar y todos se deciden al ejecutarse, con los que estén conectados en ese momento
      const effectiveMode = mode ?? rule.target ?? 'me';
      const t = target ?? (this.targets
        ? await this.targets.resolve(effectiveMode, event.input)
        : { selector: this.context.player, display: this.context.player });
      try { event.onTarget?.(t); } catch { /* solo informativo */ }
      // En comandos {target} es el nombre o el selector (@a[...]); en textos, el nombre o "todos"
      const commandVars = { ...vars, target: t.selector, titleTarget: t.selector };
      const textVars = { ...vars, target: t.display, titleTarget: t.selector };
      if (effectiveMode !== 'me') log.info(`🎯 "${this.ruleLabel(rule.id)}" → ${t.display}`);
      // Avisar (overlay) justo cuando la regla se ejecuta, en el mismo orden que el juego
      for (const fn of this.runListeners) {
        try { fn(rule, event, this.ruleLabel(rule.id)); } catch (err) { log.error('Error en aviso de regla:', err.message); }
      }
      try {
        for (const action of rule.actions ?? []) {
          const run = this.actions[action.type];
          if (!run) {
            log.error(`Tipo de acción desconocido: "${action.type}"`);
            continue;
          }
          await run(action, action.type === 'minecraft' ? commandVars : textVars, event);
        }
      } catch (err) {
        this.#record(event, rule, 'error', { target: t.display, reason: err.message });
        throw err;
      }
      this.#record(event, rule, 'ok', { target: t.display });
      await event.complete?.().catch(() => {});
    });
    if (!accepted) this.#record(event, rule, 'pausa');
    return accepted;
  }

  /** Recibe cada interacción con su resultado: fn(registro). */
  onRecord(fn) {
    this.recordListeners.add(fn);
  }

  #record(event, rule, status, extra = {}) {
    if (this.recordListeners.size === 0) return;
    const rec = {
      status,
      platform: event.platform,
      type: event.type,
      rule: rule?.id ?? null,
      label: rule ? this.ruleLabel(rule.id) : (event.name ?? event.type),
      user: event.user?.displayName ?? '',
      userId: event.user?.id ? `${event.platform}:${event.user.id}` : null,
      amount: event.amount || undefined,
      currency: event.currency || undefined,
      input: event.input ? String(event.input).slice(0, 80) : undefined,
      test: event.platform === 'simulado' || undefined,
      ...extra
    };
    for (const fn of this.recordListeners) {
      try { fn(rec); } catch (err) { log.error('Error guardando historial:', err.message); }
    }
  }

  /** Recibe cada regla en el momento en que se ejecuta: fn(rule, event, label). */
  onRuleRun(fn) {
    this.runListeners.add(fn);
  }

  /** La regla que se usaría para este evento (la primera que coincide), o null. */
  findRule(event) {
    return this.rules.find((r) => matches(r.trigger, event)) ?? null;
  }

  /** ¿Existe una regla activa con ese id? */
  hasRule(id) {
    return this.rules.some((r) => r.id === id);
  }

  /** Nombre legible de una regla (título de la recompensa, comando o monto de bits). */
  ruleLabel(id) {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) return id;
    const t = rule.trigger ?? {};
    if (t.type === 'donation') return t.minAmount ? `$${t.minAmount}+${t.currency ? ` ${t.currency}` : ''}` : 'Donación';
    return t.name ?? (t.minAmount ? `${t.minAmount}+ bits` : rule.id);
  }

  /**
   * Ejecuta una regla directamente (votaciones, modo caos), sin revisar disparador ni cooldowns.
   * target: 'random' | 'all' | 'me' para ignorar el objetivo de la regla (modo caos).
   */
  runRule(id, event, { target } = {}) {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) return false;
    log.event(`${event.platform} → regla "${id}" (${this.ruleLabel(id)})`);
    return this.enqueueRule(rule, event, id, null, target ?? null);
  }

  /** Avisa del cooldown una sola vez por usuario y regla mientras dure la espera (evita spam). */
  async warnCooldown(event, userKey, until, secs, refunded) {
    if (!this.settings.cooldownReplies) return;
    if ((this.warned.get(userKey) ?? 0) > Date.now()) return;
    this.warned.set(userKey, until);
    const what = event.type === 'reward' ? `"${event.name}"` : event.name;
    const extra = refunded ? ' Te devolví tus puntos.' : '';
    await this.reply(event, `@${event.user.name} ${what} estará disponible en ${formatSecs(secs)}.${extra}`);
  }

  /** !comandos → lista los comandos activos. */
  async help(event) {
    const now = Date.now();
    if (now - this.lastHelp < this.settings.helpCooldownMs) return;
    this.lastHelp = now;
    const commands = [...new Set(this.rules
      .filter((r) => r.trigger?.type === 'command' && r.trigger.name && (!r.trigger.platform || r.trigger.platform === event.platform))
      .map((r) => r.trigger.name))];
    const msg = commands.length
      ? `Comandos: ${commands.join(' ')} · También puedes canjear recompensas con puntos del canal.`
      : 'Por ahora no hay comandos activos.';
    await this.reply(event, msg);
  }
}

function matches(trigger, event) {
  if (!trigger || trigger.type !== event.type) return false;
  if (trigger.platform && trigger.platform !== event.platform) return false;
  if (trigger.name && trigger.name.toLowerCase() !== event.name.toLowerCase()) return false;
  if (trigger.minAmount && (event.amount ?? 0) < trigger.minAmount) return false;
  if (trigger.maxAmount && (event.amount ?? 0) > trigger.maxAmount) return false;
  if (trigger.currency && trigger.currency.toUpperCase() !== String(event.currency ?? '').toUpperCase()) return false;
  return true;
}

function formatSecs(secs) {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Limpia texto del chat antes de meterlo en un comando de Minecraft. */
function safe(text = '') {
  return String(text).replace(/[^\p{L}\p{N} _\-.,!?¡¿]/gu, '').trim().slice(0, 40);
}

/** Reemplaza {variables} en un texto. */
export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

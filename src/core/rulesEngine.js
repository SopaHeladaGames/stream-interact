import fs from 'node:fs';
import { log } from './logger.js';
import { formatMoney } from './money.js';

/**
 * Lee config/rules.json y decide qué acciones ejecutar para cada evento.
 * Se recarga solo cuando guardas el archivo (no necesitas reiniciar).
 */
export class RulesEngine {
  constructor({ rulesPath, bus, actions, context }) {
    this.rulesPath = rulesPath;
    this.bus = bus;
    this.actions = actions;   // { minecraft: fn, chat: fn, ... }
    this.context = context;   // variables fijas, ej. { player }
    this.rules = [];
    this.settings = {};
    this.lastRun = new Map();       // ruleKey -> timestamp
    this.lastRunByUser = new Map(); // `${ruleKey}:${userId}` -> timestamp
    this.warned = new Map();        // `${ruleKey}:${userId}` -> hasta cuándo ya se avisó
    this.lastHelp = 0;
    this.runListeners = new Set();
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
    if (!rule) return;

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
      await this.warnCooldown(event, userKey, now + waitMs, secs, refunded);
      return;
    }

    const accepted = this.enqueueRule(rule, event, ruleKey);

    if (accepted) {
      this.lastRun.set(ruleKey, now);
      this.lastRunByUser.set(userKey, now);
    } else {
      await event.refund?.().catch(() => {});
    }
  }

  /** Pone en la cola las acciones de una regla. Devuelve false si la cola la rechazó (pausa o llena). */
  enqueueRule(rule, event, ruleKey) {
    const vars = {
      ...this.context,
      user: safe(event.user.displayName),
      input: safe(event.input),
      amount: String(event.amount ?? 0),
      currency: event.currency ?? '',
      money: event.type === 'donation' ? formatMoney(event.amount, event.currency) : String(event.amount ?? 0),
      platform: event.platform
    };

    return this.bus.enqueue(ruleKey, async () => {
      // Avisar (overlay) justo cuando la regla se ejecuta, en el mismo orden que el juego
      for (const fn of this.runListeners) {
        try { fn(rule, event, this.ruleLabel(rule.id)); } catch (err) { log.error('Error en aviso de regla:', err.message); }
      }
      for (const action of rule.actions ?? []) {
        const run = this.actions[action.type];
        if (!run) {
          log.error(`Tipo de acción desconocido: "${action.type}"`);
          continue;
        }
        await run(action, vars, event);
      }
      await event.complete?.().catch(() => {});
    });
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
    return t.name ?? (t.minAmount ? `${t.minAmount}+ bits` : rule.id);
  }

  /** Ejecuta una regla directamente (votaciones, modo caos), sin revisar disparador ni cooldowns. */
  runRule(id, event) {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) return false;
    log.event(`${event.platform} → regla "${id}" (${this.ruleLabel(id)})`);
    return this.enqueueRule(rule, event, id);
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

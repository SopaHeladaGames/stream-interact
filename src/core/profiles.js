import fs from 'node:fs';
import path from 'node:path';
import { log } from './logger.js';

/**
 * Perfiles de juego (Minecraft, otro juego…). Solo uno está activo a la vez:
 *  - Las reglas con `profile` solo funcionan cuando su perfil está activo.
 *  - Las recompensas asignadas a un perfil se encienden al activarlo y se apagan al activar otro.
 *  - Lo que no tiene perfil funciona siempre.
 * Se guarda en config/perfiles.json: { active, profiles: [{ id, name }], rewards: { rewardId: profileId } }
 */
const httpError = (status, message) => Object.assign(new Error(message), { status });

export class ProfileStore {
  constructor(file, { getTwitch, rulesStore, onRulesChanged } = {}) {
    this.file = file;
    this.getTwitch = getTwitch;         // () => adaptador de Twitch (o null si no está conectado)
    this.rulesStore = rulesStore;       // para quitar el perfil de las reglas al borrarlo
    this.onRulesChanged = onRulesChanged;
    this.data = { active: null, profiles: [], rewards: {} };
    try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* primera vez */ }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  get active() { return this.data.active; }

  #get(id) {
    const p = this.data.profiles.find((x) => x.id === id);
    if (!p) throw httpError(404, 'Ese perfil no existe');
    return p;
  }

  list() {
    const counts = (id) => Object.values(this.data.rewards).filter((p) => p === id).length;
    return {
      active: this.data.active,
      profiles: this.data.profiles.map((p) => ({ ...p, rewards: counts(p.id) })),
      rewards: this.data.rewards
    };
  }

  summary() {
    const p = this.data.profiles.find((x) => x.id === this.data.active);
    return { profile: p ? { id: p.id, name: p.name } : null, profiles: this.data.profiles.map(({ id, name }) => ({ id, name })) };
  }

  add(name) {
    const clean = String(name ?? '').trim().slice(0, 30);
    if (!clean) throw httpError(400, 'Ponle nombre al perfil');
    let id = clean.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'perfil';
    const base = id;
    for (let n = 2; this.data.profiles.some((p) => p.id === id); n++) id = `${base}-${n}`;
    this.data.profiles.push({ id, name: clean });
    this.#save();
    return this.list();
  }

  rename(id, name) {
    const clean = String(name ?? '').trim().slice(0, 30);
    if (!clean) throw httpError(400, 'Ponle nombre al perfil');
    this.#get(id).name = clean;
    this.#save();
    return this.list();
  }

  remove(id) {
    this.#get(id);
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
    for (const [rewardId, p] of Object.entries(this.data.rewards)) if (p === id) delete this.data.rewards[rewardId];
    if (this.data.active === id) this.data.active = null;
    this.#save();
    // Sus reglas pasan a funcionar siempre (sin perfil), en vez de quedarse apagadas para siempre
    if (this.rulesStore) {
      const current = this.rulesStore.read();
      const rules = (current.rules ?? []).map(({ profile, ...r }) => (profile === id ? r : { ...r, ...(profile ? { profile } : {}) }));
      this.rulesStore.write({ settings: current.settings, rules });
      this.onRulesChanged?.();
    }
    return this.list();
  }

  /** Asigna una recompensa a un perfil (o a ninguno) y la deja encendida/apagada según el perfil activo. */
  async assignReward(rewardId, profileId) {
    if (!rewardId) throw httpError(400, 'Falta la recompensa');
    if (profileId) this.#get(profileId);
    if (profileId) this.data.rewards[rewardId] = profileId;
    else delete this.data.rewards[rewardId];
    this.#save();
    let enabled = null;
    const twitch = this.getTwitch?.();
    if (profileId && twitch) {
      enabled = profileId === this.data.active;
      await twitch.updateReward(rewardId, { isEnabled: enabled });
    }
    return { ...this.list(), rewardId, enabled };
  }

  /** Activa un perfil (o ninguno con null): enciende sus recompensas y apaga las de los demás perfiles. */
  async activate(id) {
    if (id) this.#get(id);
    this.data.active = id || null;
    this.#save();
    const result = { active: this.data.active, enabled: 0, disabled: 0, failed: [] };
    const twitch = this.getTwitch?.();
    const assigned = Object.entries(this.data.rewards);
    if (!twitch || assigned.length === 0) return { ...result, twitch: Boolean(twitch) };

    let rewards = [];
    try { rewards = await twitch.listRewards(); } catch (err) { throw httpError(502, `No pude leer tus recompensas de Twitch: ${err.message}`); }
    const byId = new Map(rewards.map((r) => [r.id, r]));
    for (const [rewardId, profileId] of assigned) {
      const reward = byId.get(rewardId);
      if (!reward) { delete this.data.rewards[rewardId]; continue; } // la borraron en Twitch
      const want = profileId === this.data.active;
      if (reward.enabled === want) continue;
      try {
        await twitch.updateReward(rewardId, { isEnabled: want });
        if (want) result.enabled++; else result.disabled++;
      } catch (err) {
        result.failed.push({ title: reward.title, error: err.message });
      }
    }
    this.#save();
    const name = this.data.profiles.find((p) => p.id === this.data.active)?.name ?? 'ninguno';
    log.info(`🎮 Perfil activo: ${name} (${result.enabled} recompensas encendidas, ${result.disabled} apagadas)`);
    return { ...result, twitch: true };
  }
}

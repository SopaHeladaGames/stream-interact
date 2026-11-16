import fs from 'node:fs';
import path from 'node:path';

/**
 * Canjes de recompensas (puntos del canal) para la pestaña "Canjes" del chat.
 *
 * status: pendiente | hecho | devuelto
 *   - Las recompensas de la app con regla se completan (o devuelven) solas.
 *   - Las de la app SIN regla quedan pendientes: las completas o devuelves desde el panel.
 *   - Las creadas en el panel de Twitch no las puede tocar la app (Twitch no lo permite):
 *     se pueden marcar como hechas aquí para llevar la cuenta, y devolver solo desde Twitch.
 *
 * Se guardan los últimos 300 en data/canjes.json.
 */
const MAX = 300;

export class RedemptionQueue {
  constructor(file) {
    this.file = file;
    this.items = [];
    try { this.items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* primera vez */ }
  }

  #save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.items.slice(-MAX), null, 2));
    } catch { /* no frenar nada por esto */ }
  }

  add(r) {
    if (this.items.some((x) => x.id === r.id)) return;
    this.items.push({ status: 'pendiente', ...r, at: r.at ?? new Date().toISOString() });
    this.items = this.items.slice(-MAX);
    this.#save();
  }

  set(id, status, extra = {}) {
    const item = this.items.find((x) => x.id === id);
    if (!item) return null;
    Object.assign(item, { status, doneAt: new Date().toISOString(), ...extra });
    this.#save();
    return item;
  }

  get(id) {
    return this.items.find((x) => x.id === id) ?? null;
  }

  list() {
    const recent = [...this.items].reverse();
    return {
      pending: recent.filter((x) => x.status === 'pendiente'),
      recent: recent.filter((x) => x.status !== 'pendiente').slice(0, 50)
    };
  }
}

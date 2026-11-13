import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ACTIONS, MC_COLORS, TRIGGERS, VARIABLES } from '../rules.js';

/** Convierte ms ↔ segundos para que en el formulario todo se vea en segundos. */
const toSecs = (ms) => (ms == null ? '' : ms / 1000);
const toMs = (value) => (value === '' ? undefined : Math.max(0, Number(value)) * 1000);

export default function RuleEditor({ rule, onChange }) {
  // Imágenes y sonidos subidos en Overlay OBS (para la acción "Alerta en overlay")
  const [mediaFiles, setMediaFiles] = useState([]);
  useEffect(() => { api.overlayArchivos().then(setMediaFiles).catch(() => {}); }, []);

  const t = rule.trigger ?? {};
  const set = (patch) => onChange({ ...rule, ...patch });
  const setTrigger = (patch) => set({ trigger: { ...t, ...patch } });

  const changeTriggerType = (type) => {
    if (type === 'cheer') setTrigger({ type, name: undefined, currency: undefined, minAmount: t.minAmount ?? 100 });
    else if (type === 'donation') setTrigger({ type, name: undefined, minAmount: t.type === 'cheer' ? 50 : (t.minAmount ?? 50) });
    else setTrigger({ type, name: type === 'command' ? (t.name?.startsWith('!') ? t.name : '!comando') : (t.name ?? ''), minAmount: undefined, maxAmount: undefined, currency: undefined });
  };

  const actions = rule.actions ?? [];
  const setActions = (fn) => set({ actions: fn(actions) });
  const updateAction = (i, next) => setActions((as) => as.map((a, j) => (j === i ? next : a)));
  const moveAction = (i, dir) => setActions((as) => {
    const to = i + dir;
    if (to < 0 || to >= as.length) return as;
    const c = [...as]; [c[i], c[to]] = [c[to], c[i]]; return c;
  });

  return (
    <div className="editor">
      <section className="card">
        <h3>Cuándo se activa</h3>
        <div className="segmented wide">
          {Object.entries(TRIGGERS).map(([type, info]) => (
            <button key={type} className={t.type === type ? 'active' : ''} onClick={() => changeTriggerType(type)} title={info.hint}>{info.label}</button>
          ))}
        </div>

        <div className="field-row">
          {t.type === 'reward' && (
            <label className="field grow">
              <span>Título de la recompensa (igual que en Twitch)</span>
              <input value={t.name ?? ''} onChange={(e) => setTrigger({ name: e.target.value })} placeholder="Invocar zombie" />
            </label>
          )}
          {t.type === 'command' && (
            <label className="field grow">
              <span>Comando</span>
              <input value={t.name ?? ''} onChange={(e) => setTrigger({ name: e.target.value.replace(/\s/g, '').toLowerCase() })} placeholder="!zombie" />
            </label>
          )}
          {t.type === 'donation' && (
            <>
              <label className="field">
                <span>Monto mínimo</span>
                <input type="number" min="0" step="0.01" value={t.minAmount ?? ''} onChange={(e) => setTrigger({ minAmount: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>Monto máximo (opcional)</span>
                <input type="number" min="0" step="0.01" value={t.maxAmount ?? ''} onChange={(e) => setTrigger({ maxAmount: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>Moneda (opcional)</span>
                <input value={t.currency ?? ''} maxLength={3} placeholder="MXN, USD…" onChange={(e) => setTrigger({ currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') || undefined })} />
              </label>
              <p className="muted small field-note">
                El monto se compara en la moneda en que llega la donación (no se convierte). Si recibes en varias monedas, crea una regla por moneda.
                Las reglas se revisan en orden: pon primero las de montos más altos.
              </p>
            </>
          )}
          {t.type === 'cheer' && (
            <>
              <label className="field">
                <span>Mínimo de bits</span>
                <input type="number" min="1" value={t.minAmount ?? ''} onChange={(e) => setTrigger({ minAmount: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>Máximo de bits (opcional)</span>
                <input type="number" min="1" value={t.maxAmount ?? ''} onChange={(e) => setTrigger({ maxAmount: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </label>
            </>
          )}
        </div>

        {t.type === 'donation' && (
          <p className="muted small">Las donaciones <strong>no usan cooldown</strong>: cada donación siempre ejecuta su regla.</p>
        )}
        <div className="field-row">
          {t.type !== 'donation' && <>
          <label className="field">
            <span>Cooldown general (s)</span>
            <input type="number" min="0" value={toSecs(rule.cooldownMs)} onChange={(e) => set({ cooldownMs: toMs(e.target.value) })} placeholder="0" />
          </label>
          <label className="field">
            <span>Cooldown por usuario (s)</span>
            <input type="number" min="0" value={toSecs(rule.userCooldownMs)} onChange={(e) => set({ userCooldownMs: toMs(e.target.value) })} placeholder="0" />
          </label>
          </>}
          <label className="field">
            <span>ID interno</span>
            <input value={rule.id ?? ''} onChange={(e) => set({ id: e.target.value.replace(/\s/g, '-') })} />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h3>Qué pasa</h3>
          <div className="vars">
            Variables: {VARIABLES.map((v) => <code key={v}>{v}</code>)}
          </div>
        </div>

        {actions.map((a, i) => (
          <div key={i} className="action">
            <div className="action-head">
              <span className="step">{i + 1}</span>
              <select value={a.type} onChange={(e) => updateAction(i, { type: e.target.value, ...ACTIONS[e.target.value].defaults })}>
                {Object.entries(ACTIONS).map(([type, info]) => <option key={type} value={type}>{info.label}</option>)}
              </select>
              <span className="spacer" />
              <button className="icon-btn" onClick={() => moveAction(i, -1)} disabled={i === 0} title="Subir">↑</button>
              <button className="icon-btn" onClick={() => moveAction(i, 1)} disabled={i === actions.length - 1} title="Bajar">↓</button>
              <button className="icon-btn danger" onClick={() => setActions((as) => as.filter((_, j) => j !== i))} title="Quitar">✕</button>
            </div>
            <ActionFields action={a} onChange={(next) => updateAction(i, next)} mediaFiles={mediaFiles} />
          </div>
        ))}

        <div className="row gap wrap">
          {Object.entries(ACTIONS).map(([type, info]) => (
            <button key={type} className="btn small ghost" onClick={() => setActions((as) => [...as, { type, ...structuredClone(info.defaults) }])}>
              + {info.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActionFields({ action, onChange, mediaFiles = [] }) {
  const set = (patch) => onChange({ ...action, ...patch });

  switch (action.type) {
    case 'minecraft':
      return (
        <label className="field">
          <span>Un comando por línea, sin “/”</span>
          <textarea
            rows={Math.max(2, (action.commands ?? []).length)}
            value={(action.commands ?? []).join('\n')}
            onChange={(e) => set({ commands: e.target.value.split('\n') })}
            placeholder="execute at {player} run summon minecraft:zombie ~3 ~ ~3"
            spellCheck={false}
            className="mono"
          />
        </label>
      );
    case 'announce':
      return (
        <div className="field-row">
          <label className="field grow">
            <span>Texto (los emojis se quitan solos)</span>
            <input value={action.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <ColorField value={action.color ?? 'yellow'} onChange={(color) => set({ color })} />
        </div>
      );
    case 'title':
      return (
        <div className="field-row">
          <label className="field grow">
            <span>Título</span>
            <input value={action.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="field grow">
            <span>Subtítulo</span>
            <input value={action.subtitle ?? ''} onChange={(e) => set({ subtitle: e.target.value })} />
          </label>
          <ColorField value={action.color ?? 'white'} onChange={(color) => set({ color })} />
        </div>
      );
    case 'chat':
      return (
        <label className="field">
          <span>Mensaje en el chat de Twitch</span>
          <input value={action.message ?? ''} onChange={(e) => set({ message: e.target.value })} />
        </label>
      );
    case 'overlay':
      return (
        <div className="field-row">
          <label className="field grow">
            <span>Texto grande</span>
            <input value={action.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="{user}" />
          </label>
          <label className="field grow">
            <span>Texto pequeño</span>
            <input value={action.subtitle ?? ''} onChange={(e) => set({ subtitle: e.target.value })} placeholder="te mandó un zombie" />
          </label>
          <label className="field">
            <span>Color</span>
            <div className="color-select">
              <input type="color" className="color-input" value={action.color || '#9b6bff'} onChange={(e) => set({ color: e.target.value })} />
              {action.color && <button type="button" className="icon-btn" title="Color automático" onClick={() => set({ color: '' })}>✕</button>}
            </div>
          </label>
          <label className="field">
            <span>Imagen / GIF</span>
            <select value={action.image ?? ''} onChange={(e) => set({ image: e.target.value })}>
              <option value="">La del tipo de alerta</option>
              {mediaFiles.filter((f) => f.type === 'image').map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Sonido</span>
            <select value={action.sound ?? ''} onChange={(e) => set({ sound: e.target.value })}>
              <option value="">El del tipo de alerta</option>
              {mediaFiles.filter((f) => f.type === 'sound').map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </label>
        </div>
      );
    case 'wait':
      return (
        <label className="field narrow">
          <span>Segundos</span>
          <input type="number" min="0" step="0.5" value={(action.ms ?? 0) / 1000} onChange={(e) => set({ ms: Math.max(0, Number(e.target.value)) * 1000 })} />
        </label>
      );
    default:
      return <div className="muted">Acción desconocida.</div>;
  }
}

function ColorField({ value, onChange }) {
  return (
    <label className="field">
      <span>Color</span>
      <div className="color-select">
        <span className="swatch" style={{ background: MC_COLORS[value] ?? '#fff' }} />
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {Object.keys(MC_COLORS).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </label>
  );
}

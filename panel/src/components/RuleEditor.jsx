import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ACTIONS, MC_COLORS, TARGETS, TRIGGERS, VARIABLES } from '../rules.js';

/** Convierte ms ↔ segundos para que en el formulario todo se vea en segundos. */
const toSecs = (ms) => (ms == null ? '' : ms / 1000);
const toMs = (value) => (value === '' ? undefined : Math.max(0, Number(value)) * 1000);

export default function RuleEditor({ rule, onChange }) {
  // Imágenes y sonidos subidos en Overlay OBS (para la acción "Alerta en overlay")
  const [mediaFiles, setMediaFiles] = useState([]);
  useEffect(() => { api.overlayArchivos().then(setMediaFiles).catch(() => {}); }, []);
  // Reglas del mundo disponibles (para la acción "Regla del mundo")
  const [gamerules, setGamerules] = useState([]);
  useEffect(() => { api.catalogoGamerules().then(setGamerules).catch(() => {}); }, []);

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

      <TargetSection rule={rule} set={set} />

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
            <ActionFields action={a} onChange={(next) => updateAction(i, next)} mediaFiles={mediaFiles} gamerules={gamerules} />
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

function ActionFields({ action, onChange, mediaFiles = [], gamerules = [] }) {
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
    case 'gamerule': {
      const gr = gamerules.find((r) => r.id === action.rule);
      const groups = { chat: 'Chat', players: 'Jugadores', world: 'Mundo' };
      return (
        <>
          <div className="field-row">
            <label className="field grow">
              <span>Regla</span>
              <select value={action.rule ?? ''} onChange={(e) => {
                const next = gamerules.find((r) => r.id === e.target.value);
                set({ rule: e.target.value, value: next?.type === 'int' ? (next.min ?? 0) : false });
              }}>
                {Object.entries(groups).map(([g, title]) => (
                  <optgroup key={g} label={title}>
                    {gamerules.filter((r) => r.group === g).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            {gr?.type === 'int' ? (
              <label className="field narrow">
                <span>Valor ({gr.min}–{gr.max})</span>
                <input type="number" min={gr.min} max={gr.max} value={action.value ?? 0} onChange={(e) => set({ value: Number(e.target.value) })} />
              </label>
            ) : (
              <label className="field narrow">
                <span>Dejarla</span>
                <select value={String(action.value === true)} onChange={(e) => set({ value: e.target.value === 'true' })}>
                  <option value="false">Desactivada</option>
                  <option value="true">Activada</option>
                </select>
              </label>
            )}
            <label className="field narrow">
              <span>Durante (s)</span>
              <input type="number" min="0" max="86400" value={action.seconds ?? 0} onChange={(e) => set({ seconds: Math.max(0, Number(e.target.value)) })} />
            </label>
          </div>
          <div className="field-row">
            <label className="field grow">
              <span>Mensaje en Minecraft cuando termine (opcional)</span>
              <input value={action.endMessage ?? ''} onChange={(e) => set({ endMessage: e.target.value })} placeholder={`${gr?.label ?? 'La regla'}: volvió a la normalidad`} />
            </label>
          </div>
          <p className="muted small field-note">
            {Number(action.seconds) > 0
              ? `Después de ${formatDuration(action.seconds)} vuelve sola a como estaba. Si se vuelve a activar antes, el tiempo se suma.`
              : 'Con 0 segundos el cambio es permanente.'}
          </p>
        </>
      );
    }
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

/** A quién le llega la regla cuando juegas con más gente. */
function TargetSection({ rule, set }) {
  const mode = rule.target ?? 'me';
  const type = rule.trigger?.type;
  const usesPlayer = (rule.actions ?? []).some((a) => a.type === 'minecraft' && (a.commands ?? []).some((c) => c.includes('{player}')));
  const usesTarget = (rule.actions ?? []).some((a) => a.type === 'minecraft' && (a.commands ?? []).some((c) => c.includes('{target}')));

  // Cambia {player} por {target} en comandos y también en los textos (mensajes, títulos, chat, overlay)
  const swapText = (v) => (typeof v === 'string' ? v.replaceAll('{player}', '{target}') : Array.isArray(v) ? v.map(swapText) : v);
  const swap = () => set({
    actions: rule.actions.map((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, k === 'type' ? v : swapText(v)])))
  });

  return (
    <section className="card">
      <h3>A quién le llega</h3>
      <div className="segmented wide">
        {Object.entries(TARGETS).map(([id, info]) => (
          <button key={id} className={mode === id ? 'active' : ''} title={info.hint} onClick={() => set({ target: id === 'me' ? undefined : id })}>{info.label}</button>
        ))}
      </div>
      <p className="muted small target-hint">
        {mode === 'me' && 'Siempre a ti. En los comandos puedes usar {player} o {target}.'}
        {mode === 'chat' && <>
          {type === 'reward' && <>El espectador escribe el nombre al canjear. En <strong>Recompensas</strong> activa “Pedir texto al espectador” y en la descripción pon algo como “¿A quién? (Many, SopaHelada…)”. </>}
          {type === 'command' && <>El espectador escribe el nombre después del comando, por ejemplo <code>{rule.trigger?.name || '!comando'} Many</code>. Sin nombre te toca a ti. </>}
          {(type === 'cheer' || type === 'donation') && <>Se busca un nombre en el mensaje del {type === 'cheer' ? 'cheer' : 'donativo'}; si no hay uno válido te toca a ti (nunca se pierde un {type === 'cheer' ? 'cheer' : 'donativo'}). </>}
          {(type === 'reward' || type === 'command') && 'Si el jugador no está conectado o está protegido, no se ejecuta, se le avisa en el chat y se devuelven los puntos.'}
        </>}
        {mode === 'random' && 'Se elige al ejecutarse, entre los conectados que no estén protegidos (tú incluido).'}
        {mode === 'all' && 'A todos los conectados menos los protegidos. En los textos, {target} se lee como “todos”.'}
      </p>
      {mode !== 'me' && usesPlayer && (
        <div className="banner warn target-warn">
          <span>Los comandos de esta regla usan <code>{'{player}'}</code>, que siempre eres tú. Para que le llegue al jugador elegido usa <code>{'{target}'}</code>.</span>
          <button className="btn small" onClick={swap}>Cambiar {'{player}'} por {'{target}'}</button>
        </div>
      )}
      {mode !== 'me' && !usesPlayer && !usesTarget && (rule.actions ?? []).some((a) => a.type === 'minecraft') && (
        <p className="muted small">Escribe <code>{'{target}'}</code> en los comandos donde va el jugador, por ejemplo <code>give {'{target}'} minecraft:diamond 1</code>.</p>
      )}
    </section>
  );
}

function formatDuration(secs) {
  const s = Math.round(Number(secs) || 0);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

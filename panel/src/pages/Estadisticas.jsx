import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const RANGES = { session: 'Este directo', today: 'Hoy', '7d': '7 días', '30d': '30 días', all: 'Todo' };
const TYPES = { reward: 'Recompensas', command: 'Comandos', cheer: 'Bits', donation: 'Donaciones', chaos: 'Modo caos', poll: 'Votaciones' };
const SINGULAR = { reward: 'Recompensa', command: 'Comando', cheer: 'Bits', donation: 'Donación', chaos: 'Modo caos', poll: 'Votación' };
const STATUS = {
  ok: { label: 'Hecho', cls: 'ok' },
  error: { label: 'Falló', cls: 'warn' },
  cooldown: { label: 'Cooldown', cls: 'off' },
  rechazada: { label: 'Rechazada', cls: 'off' },
  pausa: { label: 'En pausa', cls: 'off' },
  'sin-regla': { label: 'Sin regla', cls: 'off' },
  limite: { label: 'Límite del directo', cls: 'off' }
};

const num = (n) => Number(n ?? 0).toLocaleString('es-MX');
const moneyText = (m = {}) => Object.entries(m).map(([cur, v]) => `$${Number(v).toLocaleString('es-MX', { maximumFractionDigits: 2 })} ${cur}`).join(' · ');
const dt = (iso, opts) => new Date(iso).toLocaleString('es-MX', { hour12: false, ...opts });

export default function Estadisticas() {
  const [range, setRange] = useState('session');
  const [custom, setCustom] = useState(null); // { from, to, label } al elegir un directo pasado
  const [tests, setTests] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  const params = useMemo(() => (custom ? { range: 'custom', from: custom.from, to: custom.to } : { range }), [range, custom]);

  useEffect(() => {
    let alive = true;
    const load = () => api.estadisticas({ ...params, tests }).then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => alive && setError(e.message));
    load();
    // Lo que está pasando ahora se actualiza solo
    const live = !custom && ['session', 'today'].includes(range);
    const id = live ? setInterval(load, 10000) : null;
    return () => { alive = false; clearInterval(id); };
  }, [params, tests]);

  const csvUrl = `/api/estadisticas/csv?${new URLSearchParams({ ...params, tests: tests ? '1' : '0' })}`;
  const recent = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.recent ?? []).filter((r) => !q || [r.user, r.label, r.target, r.input].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [data, filter]);

  return (
    <>
      <div className="section-head">
        <h1>Estadísticas</h1>
        <a className="btn" href={csvUrl} download>⬇ Exportar CSV</a>
      </div>

      <div className="stats-filters">
        <div className="segmented">
          {Object.entries(RANGES).map(([id, label]) => (
            <button key={id} className={!custom && range === id ? 'active' : ''} onClick={() => { setCustom(null); setRange(id); }}>{label}</button>
          ))}
          {custom && <button className="active">{custom.label}</button>}
        </div>
        <label className="check"><input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} /> Incluir pruebas</label>
        {data && <span className="muted small">{data.totals.interactions || data.recent.length ? `${dt(data.from, { dateStyle: 'medium', timeStyle: 'short' })} – ${dt(data.to, { timeStyle: 'short' })}` : ''}</span>}
      </div>

      {error && <div className="banner error">{error}</div>}
      {data && data.recent.length === 0 && (
        <div className="card empty-card">
          {range === 'session' && !custom
            ? 'Todavía no hay actividad en este directo. Cada recompensa, comando, bits o donación que use tu chat aparecerá aquí.'
            : 'No hay actividad en este periodo.'}
        </div>
      )}

      {data && data.recent.length > 0 && (
        <>
          <div className="cards stat-tiles">
            <Tile title="Interacciones" value={num(data.totals.interactions)} detail={Object.entries(data.byType).map(([t, n]) => `${num(n)} ${TYPES[t]?.toLowerCase() ?? t}`).join(' · ')} />
            <Tile title="Espectadores" value={num(data.totals.viewers)} detail="distintos que participaron" />
            <Tile title="Bits" value={num(data.totals.bits)} detail={data.topBits[0] ? `Top: ${data.topBits[0].user} (${num(data.topBits[0].bits)})` : '—'} />
            <Tile title="Donaciones" value={moneyText(data.totals.money) || '$0'} detail={Object.keys(data.totals.money).length > 1 ? 'por moneda, sin convertir' : ' '} small={Object.keys(data.totals.money).length > 1} />
            <Tile title="No se ejecutaron" value={num(data.totals.rejected + data.totals.failed)} detail={`${num(data.totals.rejected)} rechazadas o en cooldown · ${num(data.totals.failed)} fallaron`} />
          </div>

          <div className="card">
            <h3>Actividad</h3>
            <Timeline points={data.timeline} bucketMs={data.bucketMs} />
          </div>

          <div className="stats-grid">
            <div className="card">
              <h3>Espectadores más activos</h3>
              <Ranked items={data.topViewers.map((v) => ({
                key: v.user, label: v.user, value: v.count,
                extra: [v.bits ? `${num(v.bits)} bits` : null, moneyText(v.money) || null].filter(Boolean).join(' · ')
              }))} unit="interacciones" />
            </div>
            <div className="card">
              <h3>Lo que más pidieron</h3>
              <Ranked items={data.topRules.map((r) => ({ key: r.rule ?? r.label, label: r.label, value: r.count }))} unit="veces" />
            </div>
          </div>

          {data.targets.length > 0 && (
            <div className="card">
              <h3>A quién le tocó</h3>
              <Ranked items={data.targets.map((t) => ({ key: t.name, label: t.name === 'todos' ? 'Todos' : t.name, value: t.count }))} unit="veces" />
            </div>
          )}

          <div className="card">
            <div className="row between wrap gap">
              <h3 className="no-margin">Registro</h3>
              <input className="stats-search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar usuario, regla, jugador…" />
            </div>
            <div className="table-wrap">
              <table className="stats-table">
                <thead><tr><th>Hora</th><th>Usuario</th><th>Qué</th><th>A quién</th><th>Monto</th><th>Resultado</th></tr></thead>
                <tbody>
                  {recent.map((r, i) => (
                    <tr key={`${r.at}-${i}`}>
                      <td className="muted">{dt(r.at, range === 'session' || range === 'today' ? { timeStyle: 'medium' } : { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>{r.user}{r.test && <span className="pill off small-pill">prueba</span>}</td>
                      <td><span className="muted small">{SINGULAR[r.type] ?? r.type} · </span>{r.label}{r.input && <span className="muted small"> “{r.input}”</span>}</td>
                      <td>{r.target ?? '—'}</td>
                      <td>{r.type === 'cheer' ? `${num(r.amount)} bits` : r.type === 'donation' ? moneyText({ [r.currency ?? '?']: r.amount }) : ''}</td>
                      <td>
                        <span className={`pill ${STATUS[r.status]?.cls ?? 'off'}`} title={r.reason ?? ''}>{STATUS[r.status]?.label ?? r.status}</span>
                        {r.refunded && <span className="muted small"> · puntos devueltos</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.recent.length >= 200 && <p className="muted small">Se muestran las últimas 200. El CSV tiene todo el periodo.</p>}
          </div>
        </>
      )}

      {data?.sessions?.length > 0 && (
        <div className="card">
          <h3>Directos anteriores</h3>
          <p className="muted small">Se separan solos cuando pasan más de 2 horas sin actividad.</p>
          <div className="sessions">
            {data.sessions.map((s) => (
              <button key={s.start} className={`session-btn ${custom?.from === s.start ? 'active' : ''}`}
                onClick={() => setCustom({ from: s.start, to: s.end, label: dt(s.start, { dateStyle: 'medium' }) })}>
                <strong>{dt(s.start, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
                <span className="muted small">{dt(s.start, { timeStyle: 'short' })}–{dt(s.end, { timeStyle: 'short' })} · {num(s.count)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Tile({ title, value, detail, small }) {
  return (
    <div className="card status stat-tile">
      <span className="card-title">{title}</span>
      <div className={`stat-value ${small ? 'small-value' : ''}`}>{value}</div>
      <div className="muted small">{detail}</div>
    </div>
  );
}

/** Barras horizontales ordenadas (una sola serie: el título dice qué se cuenta). */
function Ranked({ items, unit }) {
  if (!items.length) return <p className="muted small">Sin datos.</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="ranked">
      {items.map((i, n) => (
        <div key={i.key} className="ranked-row" title={`${i.label}: ${num(i.value)} ${unit}`}>
          <span className="ranked-pos muted">{n + 1}</span>
          <div className="ranked-main">
            <div className="ranked-label"><span>{i.label}</span><span className="ranked-num">{num(i.value)}</span></div>
            <div className="ranked-track"><div className="ranked-bar" style={{ width: `${(i.value / max) * 100}%` }} /></div>
            {i.extra && <div className="muted small">{i.extra}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Interacciones por intervalo de tiempo, con tooltip al pasar el mouse. */
function Timeline({ points, bucketMs }) {
  const [hover, setHover] = useState(null);
  if (!points.length) return <p className="muted small">Sin datos.</p>;
  const max = Math.max(...points.map((p) => p.count), 1);
  const fmt = (iso) => (bucketMs >= 86400e3 ? dt(iso, { day: 'numeric', month: 'short' }) : dt(iso, { hour: '2-digit', minute: '2-digit' }));
  const step = Math.max(1, Math.ceil(points.length / 8));
  const unit = bucketMs >= 86400e3 ? 'por día' : bucketMs >= 3600e3 ? 'por hora' : 'cada 10 min';
  const ticks = [max, Math.round(max / 2), 0].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div className="timeline">
      <div className="timeline-plot">
        <div className="timeline-axis">{ticks.map((t) => <span key={t}>{t}</span>)}</div>
        <div className="timeline-bars" onMouseLeave={() => setHover(null)}>
          {points.map((p, i) => (
            <div key={p.t} className="timeline-slot" onMouseEnter={() => setHover(i)}>
              <div className={`timeline-bar ${hover === i ? 'hover' : ''}`} style={{ height: `${(p.count / max) * 100}%` }} />
            </div>
          ))}
          {hover !== null && (
            <div className="chart-tip" style={{ left: `${((hover + 0.5) / points.length) * 100}%` }}>
              <strong>{num(points[hover].count)}</strong> interacciones<br /><span className="muted">{fmt(points[hover].t)}</span>
            </div>
          )}
        </div>
      </div>
      <div className="timeline-labels">
        {points.map((p, i) => <span key={p.t}>{i % step === 0 ? fmt(p.t) : ''}</span>)}
      </div>
      <div className="muted small">Interacciones {unit}</div>
    </div>
  );
}

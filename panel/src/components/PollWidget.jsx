import { useEffect, useState } from 'react';
import { api } from '../api.js';

const RESULT_VISIBLE_MS = 20000;

/**
 * Votación en vivo: barras con el conteo y el tiempo restante.
 * - En la columna del chat se muestra solo mientras hay votación (y unos segundos después, con el resultado).
 * - Con `controls` (página Votaciones) incluye botones para terminar, cancelar y simular votos.
 */
export default function PollWidget({ live, controls = false, onError }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!live) { setStatus(null); return; }
    let alive = true;
    const tick = () => api.votacion().then((s) => alive && setStatus(s)).catch(() => {});
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [live]);

  if (!status) return null;
  const run = (fn) => () => fn().then(setStatus).catch((e) => onError?.(e.message));

  const poll = status.active;
  if (poll) {
    const max = Math.max(1, ...poll.options.map((o) => o.votes));
    const seconds = Math.ceil(poll.remainingMs / 1000);
    return (
      <div className="poll-widget">
        <div className="poll-head">
          <span className="poll-tag">Votación</span>
          <span className={`poll-timer ${seconds <= 5 ? 'ending' : ''}`}>{seconds}s</span>
        </div>
        <div className="poll-question">{poll.question}</div>
        <div className="poll-progress"><span style={{ width: `${(poll.remainingMs / (poll.duration * 1000)) * 100}%` }} /></div>
        {poll.options.map((o, i) => (
          <div key={i} className="poll-option">
            <span className="poll-num">{i + 1}</span>
            <div className="poll-bar">
              <span className="poll-fill" style={{ width: `${(o.votes / max) * 100}%` }} />
              <span className="poll-label">{o.label}</span>
              <span className="poll-count">{o.votes}{poll.total > 0 && ` · ${Math.round((o.votes / poll.total) * 100)}%`}</span>
            </div>
            {controls && (
              <button className="btn small ghost" title="Simular un voto de prueba" onClick={run(() => api.votar(i + 1, `Prueba${Math.floor(Math.random() * 100000)}`))}>+1</button>
            )}
          </div>
        ))}
        {controls && (
          <div className="row gap end poll-controls">
            <button className="btn small" onClick={run(api.terminarVotacion)}>Terminar ya</button>
            <button className="btn small danger" onClick={run(api.cancelarVotacion)}>Cancelar</button>
          </div>
        )}
      </div>
    );
  }

  const last = status.last;
  const recent = last && Date.now() - new Date(last.endedAt).getTime() < RESULT_VISIBLE_MS;
  if (!last || (!controls && !recent)) return null;

  const max = Math.max(1, ...last.options.map((o) => o.votes));
  const verdict = last.reason === 'cancelled' ? 'Cancelada'
    : last.winner === null ? 'Nadie votó'
      : `Ganó: ${last.options[last.winner].label}`;
  return (
    <div className="poll-widget finished">
      <div className="poll-head">
        <span className="poll-tag">{controls ? 'Última votación' : 'Resultado'}</span>
        <span className="poll-verdict">{verdict}</span>
      </div>
      <div className="poll-question">{last.question}</div>
      {last.options.map((o, i) => (
        <div key={i} className={`poll-option ${i === last.winner ? 'winner' : ''}`}>
          <span className="poll-num">{i + 1}</span>
          <div className="poll-bar">
            <span className="poll-fill" style={{ width: `${(o.votes / max) * 100}%` }} />
            <span className="poll-label">{o.label}</span>
            <span className="poll-count">{o.votes}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

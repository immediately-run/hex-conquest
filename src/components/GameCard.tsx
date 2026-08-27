import { useState } from 'react';
import { seatStatus, type GameSummary } from '../lib/games';
import { citiesOf, possessive, NEUTRAL } from '../lib/engine';
import type { Store } from '../lib/store';

interface Props {
  store: Store;
  game: GameSummary;
  login: string;
  onOpen: () => void;
  onJoin: (slot: number) => void;
  onDelete: () => void;
}

const color = (i: number): string => (i === NEUTRAL ? 'var(--pn)' : `var(--p${i})`);

function GameCard({ store, game, login, onOpen, onJoin, onDelete }: Props) {
  const { meta, claims, state } = game;
  // Inline confirm: window.confirm() is silently false inside a sandboxed iframe.
  const [confirming, setConfirming] = useState(false);
  const status = seatStatus(store, game, login);
  const shared = store.kind === 'space';
  const openSeats = shared ? meta.seats.filter((s) => s.kind === 'human' && !claims[s.slot]) : [];
  const mySeats = meta.seats.filter((s) => claims[s.slot]?.login === login && login);
  let line: string;
  if (!state) line = 'No turn data yet';
  else if (state.winner !== null) line = `Finished — ${state.players[state.winner].name} won`;
  else if (status.kind === 'mine') line = 'Your move';
  else if (status.kind === 'ai') line = 'Computer to move';
  else if (status.kind === 'waiting') line = `Waiting for ${status.login}`;
  else line = `${possessive(state.players[state.current].name)} seat is open`;

  return (
    <div className="card">
      <h3>{meta.name}</h3>
      <div className="meta">
        {state ? `Turn ${state.turn} of ${meta.settings.turnLimit}` : '—'} · {meta.settings.width}×{meta.settings.height} · seed {meta.settings.seed} · {line}
      </div>
      <div className="seats">
        {meta.seats.map((s) => (
          <span
            key={s.slot}
            className={`seat${state && state.current === s.slot && state.winner === null ? ' current' : ''}`}
            style={{ ['--seat-color' as string]: color(s.slot) }}
          >
            <span className="dot" />
            {s.name}
            {state && ` · ${citiesOf(state, s.slot).length}c`}
            {s.kind === 'ai' ? <span className="login">AI</span> : claims[s.slot] ? <span className="login">@{claims[s.slot]!.login}</span> : shared ? <span className="login">open</span> : null}
          </span>
        ))}
      </div>
      <div className="row">
        <button className="btn btn-primary btn-sm" type="button" onClick={onOpen} disabled={!state}>
          {state?.winner !== null && state ? 'Review' : status.kind === 'mine' ? 'Play' : 'Open'}
        </button>
        {openSeats.map((s) => (
          <button key={s.slot} className="btn btn-ghost btn-sm" type="button" onClick={() => onJoin(s.slot)} disabled={!login || store.mode !== 'rw'}>
            Join as {s.name}
          </button>
        ))}
        <span className="grow" />
        {mySeats.length > 0 && shared && <span className="hint">you: {mySeats.map((s) => s.name).join(', ')}</span>}
        {store.mode === 'rw' && !confirming && (
          <button className="btn btn-ghost btn-sm btn-danger" type="button" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
        {confirming && (
          <>
            <button className="btn btn-ghost btn-sm btn-danger" type="button" onClick={onDelete}>
              Really delete{shared ? ' for everyone' : ''}?
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default GameCard;

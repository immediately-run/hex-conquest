import type { GameMeta, SeatStatus } from '../lib/games';
import { possessive, type GameState, NEUTRAL } from '../lib/engine';

interface Props {
  state: GameState;
  meta: GameMeta;
  status: SeatStatus;
  busy: boolean;
  onExit: () => void;
}

const color = (i: number): string => (i === NEUTRAL ? 'var(--pn)' : `var(--p${i})`);

function TurnBanner({ state, meta, status, busy, onExit }: Props) {
  const p = state.players[state.current];
  let line: string;
  let live = false;
  if (state.winner !== null) line = `${state.players[state.winner].name} wins`;
  else if (status.kind === 'ai') {
    line = busy ? 'Computer is thinking…' : 'Computer to move';
    live = true;
  } else if (status.kind === 'waiting') {
    line = `Waiting for ${status.login}…`;
    live = true;
  } else if (status.kind === 'open') line = 'Open seat';
  else line = 'Your move';

  return (
    <div className="banner">
      <button className="btn btn-ghost btn-sm back" type="button" onClick={onExit} aria-label="Back to lobby">
        ← Lobby
      </button>
      <span className="dot" style={{ background: color(state.winner ?? state.current) }} />
      <div className="turn">
        {state.winner !== null ? 'Game over' : `${possessive(p.name)} turn`}
        <small>
          Turn {state.turn} of {state.settings.turnLimit} · {meta.name}
        </small>
      </div>
      <div className="status">
        {live && <span className="pulse" />}
        <span>{line}</span>
      </div>
    </div>
  );
}

export default TurnBanner;

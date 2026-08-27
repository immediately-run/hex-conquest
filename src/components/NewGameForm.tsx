import { useState } from 'react';
import { createGameFiles, type Seat } from '../lib/games';
import type { PlayerKind } from '../lib/engine';
import type { Store } from '../lib/store';

interface Props {
  store: Store;
  login: string;
  onCreated: (id: string) => void;
}

const SIZES = {
  small: { width: 9, height: 7, label: 'Small 9×7' },
  medium: { width: 11, height: 9, label: 'Medium 11×9' },
  large: { width: 15, height: 11, label: 'Large 15×11' },
} as const;
type SizeKey = keyof typeof SIZES;

const randomSeed = (): string => Math.random().toString(36).slice(2, 8);
const DEFAULT_NAMES = ['Blue', 'Red', 'Gold', 'Green'];

function NewGameForm({ store, login, onCreated }: Props) {
  const shared = store.kind === 'space';
  const [name, setName] = useState('');
  const [seats, setSeats] = useState<Seat[]>([
    { slot: 0, name: login || 'Blue', kind: 'human' },
    { slot: 1, name: 'Computer', kind: 'ai' },
  ]);
  const [size, setSize] = useState<SizeKey>('medium');
  const [seed, setSeed] = useState(randomSeed);
  const [turnLimit, setTurnLimit] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setSeat = (i: number, patch: Partial<Seat>) => setSeats((xs) => xs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setKind = (i: number, kind: PlayerKind) => {
    const s = seats[i];
    const autoName = s.name === 'Computer' || DEFAULT_NAMES.includes(s.name) || s.name === login;
    setSeat(i, { kind, name: autoName ? (kind === 'ai' ? 'Computer' : DEFAULT_NAMES[i]) : s.name });
  };
  const addSeat = () => setSeats((xs) => (xs.length < 4 ? [...xs, { slot: xs.length, name: DEFAULT_NAMES[xs.length], kind: 'ai' }] : xs));
  const removeSeat = () => setSeats((xs) => (xs.length > 2 ? xs.slice(0, -1) : xs));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const humans = seats.filter((s) => s.kind === 'human').length;
      if (humans === 0) throw new Error('At least one human, please.');
      const label = name.trim() || `${seats.map((s) => s.name).join(' vs ')}`;
      const g = await createGameFiles(store, {
        name: label,
        login,
        settings: { ...SIZES[size], seed: seed.trim() || randomSeed(), turnLimit: Math.max(10, Math.min(99, turnLimit)) },
        seats: seats.map((s, i) => ({ ...s, slot: i, name: s.name.trim() || DEFAULT_NAMES[i] })),
      });
      onCreated(g.meta.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card form">
      <h3>New game</h3>
      <div className="field">
        <label htmlFor="ng-name">Name</label>
        <input id="ng-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
      </div>
      <div className="field">
        <label>Players</label>
        {seats.map((s, i) => (
          <div className="seatrow" key={i}>
            <span className="dot" style={{ background: `var(--p${i})` }} />
            <input aria-label={`Player ${i + 1} name`} value={s.name} onChange={(e) => setSeat(i, { name: e.target.value })} />
            <div className="seg">
              <button type="button" className={s.kind === 'human' ? 'active' : ''} onClick={() => setKind(i, 'human')}>
                Human
              </button>
              <button type="button" className={s.kind === 'ai' ? 'active' : ''} onClick={() => setKind(i, 'ai')}>
                AI
              </button>
            </div>
            <span />
          </div>
        ))}
        <div className="inline">
          <button className="btn btn-ghost btn-sm" type="button" onClick={addSeat} disabled={seats.length >= 4}>
            + Add player
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={removeSeat} disabled={seats.length <= 2}>
            − Remove
          </button>
        </div>
        {shared && <span className="hint">You take the first human seat; other human seats stay open until someone joins from the lobby.</span>}
        {!shared && seats.filter((s) => s.kind === 'human').length > 1 && <span className="hint">Several humans in a private game = hot-seat on this device.</span>}
      </div>
      <div className="inline">
        <div className="field">
          <label htmlFor="ng-size">Map</label>
          <select id="ng-size" value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>
            {(Object.keys(SIZES) as SizeKey[]).map((k) => (
              <option key={k} value={k}>
                {SIZES[k].label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ng-seed">Seed</label>
          <input id="ng-seed" value={seed} onChange={(e) => setSeed(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ng-turns">Turns</label>
          <input id="ng-turns" type="number" min={10} max={99} value={turnLimit} onChange={(e) => setTurnLimit(Number(e.target.value))} />
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div>
        <button className="btn btn-primary" type="button" onClick={() => void submit()} disabled={busy || store.mode !== 'rw'}>
          Start game →
        </button>
      </div>
    </div>
  );
}

export default NewGameForm;

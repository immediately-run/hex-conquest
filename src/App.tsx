// Root component — immediately.run renders the default export of THIS file.
// Global CSS is imported here (not in main.tsx) because immediately.run's
// runtime never loads main.tsx; anything the rendered tree needs must be
// reachable from App.tsx.
import './index.css';
import './App.css';
import './game.css';
import { useState } from 'react';
import { useStores } from './hooks/useStores';
import TopBar from './components/TopBar';
import Lobby, { type StoreKind } from './components/Lobby';
import GameScreen from './components/GameScreen';

type View = { kind: 'lobby' } | { kind: 'game'; store: StoreKind; id: string };

function App() {
  const stores = useStores();
  const [view, setView] = useState<View>({ kind: 'lobby' });
  const store = view.kind === 'game' ? (view.store === 'shared' ? stores.shared : stores.priv) : null;

  if (view.kind === 'game' && store) {
    return (
      <GameScreen key={`${store.root}/${view.id}`} store={store} gameId={view.id} login={stores.login} onExit={() => setView({ kind: 'lobby' })} />
    );
  }

  return (
    <div className="app">
      <TopBar login={stores.login} onHome={() => setView({ kind: 'lobby' })} />
      {stores.ready || stores.priv ? (
        <Lobby stores={stores} onOpen={(kind, id) => setView({ kind: 'game', store: kind, id })} />
      ) : (
        <div className="loading">Opening your storage…</div>
      )}
    </div>
  );
}

export default App;

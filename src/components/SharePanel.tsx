import type { Stores } from '../hooks/useStores';

interface Props {
  stores: Stores;
}

function SharePanel({ stores }: Props) {
  const { shared, sharedLost } = stores;
  return (
    <div className="card">
      <h3>Play with others</h3>
      {shared ? (
        <>
          <div className="meta">
            Shared space: {shared.name ?? shared.spaceId} · {shared.mode === 'rw' ? 'read/write' : 'read-only'}
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Games in this space are visible to everyone the space is shared with. Invite people from the
            platform's Spaces UI — the app itself cannot send invitations.
          </p>
          <div className="row">
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void stores.pickShared()}>
              Switch space
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void stores.forgetShared()}>
              Forget
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 8 }}>
            {sharedLost
              ? 'Your remembered space needs to be granted again — open it below to continue.'
              : 'Create or open a shared space to take turns with friends. Everyone who has the space plays from their own device; the app polls the space for new turns.'}
          </p>
          <div className="row">
            <button className="btn btn-primary btn-sm" type="button" onClick={() => void stores.createShared()}>
              Create a shared space
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void stores.pickShared()}>
              Open a shared space
            </button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Share the space itself with others from the platform's Spaces UI.
          </p>
        </>
      )}
    </div>
  );
}

export default SharePanel;

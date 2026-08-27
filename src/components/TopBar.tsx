import ThemeSwitch from './ThemeSwitch';

interface Props {
  login: string;
  onHome: () => void;
}

function TopBar({ login, onHome }: Props) {
  return (
    <header className="topbar">
      <button className="logo" type="button" onClick={onHome}>
        <span className="mark" />
        Hex conquest
      </button>
      <div className="right">
        {login && <span className="who">@{login}</span>}
        <ThemeSwitch />
      </div>
    </header>
  );
}

export default TopBar;

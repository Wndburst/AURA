export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={small ? 'logo logo--sm' : 'logo'}>
      <h1 className="logo__title">
        <span className="skull">☠️</span> Aura Farm <span className="skull">☠️</span>
      </h1>
      {!small && <p className="logo__sub">el público decide tu aura</p>}
    </div>
  );
}

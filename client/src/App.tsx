import { useEffect } from 'react';
import { useStore, selectArenaBattle } from './store/useStore';
import { NicknameScreen } from './screens/NicknameScreen';
import { GateScreen } from './screens/GateScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { Arena } from './components/Arena';
import { Toasts } from './components/Toasts';

export default function App() {
  const init = useStore((s) => s.init);
  const screen = useStore((s) => s.screen);
  const arenaBattle = useStore(selectArenaBattle);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <>
      <Toasts />

      {screen === 'nickname' && (
        <div className="app">
          <NicknameScreen />
        </div>
      )}

      {screen === 'gate' && (
        <div className="app">
          <GateScreen />
        </div>
      )}

      {screen === 'lobby' && <LobbyScreen />}

      {/* La arena se monta encima del lobby: es una capa, no una ruta. */}
      {screen === 'lobby' && arenaBattle && <Arena battle={arenaBattle} />}
    </>
  );
}

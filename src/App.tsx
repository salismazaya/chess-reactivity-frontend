import { useState } from 'react';
import { LobbyView } from './views/LobbyView';
import { GameView } from './views/GameView';
import type { GameContext } from './views/LobbyView';

type View = 'lobby' | 'game';

interface GameSession {
  context: GameContext;
  gameId: number;
}

function App() {
  const [view, setView] = useState<View>('lobby');
  const [session, setSession] = useState<GameSession | null>(null);

  const handleEnterGame = (ctx: GameContext, gameId: number) => {
    setSession({ context: ctx, gameId });
    setView('game');
  };

  const handleExit = () => {
    setSession(null);
    setView('lobby');
  };

  if (view === 'game' && session) {
    return (
      <GameView
        context={session.context}
        gameId={session.gameId}
        onExit={handleExit}
      />
    );
  }

  return <LobbyView onEnterGame={handleEnterGame} />;
}

export default App;

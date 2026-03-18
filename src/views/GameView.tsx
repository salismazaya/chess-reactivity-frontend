import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { encodeMove } from '../sdk';
import { Board } from '../components/Board';
import type { GameContext } from './LobbyView';
import type { SubscriptionCallback } from '@somnia-chain/reactivity';

const GAME_ADDRESS = import.meta.env.VITE_GAME_CONTRACT_ADDRESS as `0x${string}`;

interface LiveEvent {
    id: number;
    timestamp: string;
    type: 'GameCreated' | 'PlayerJoined' | 'Move' | 'GameEnd' | 'unknown';
    label: string;
    color: string;
}

interface GameViewProps {
    context: GameContext;
    gameId: number;
    onExit: () => void;
}

type Outcome = 1 | 2 | 3;
const OUTCOME_LABELS: Record<Outcome, string> = {
    1: 'White wins 👑',
    2: 'Black wins 👑',
    3: 'Draw 🤝',
};

export function GameView({ context, gameId, onExit }: GameViewProps) {
    const { chessSDK, gameSDK, reactivitySDK } = context;

    const [gameState, setGameState] = useState<bigint>(0n);
    const [p1Turn, setP1Turn] = useState<boolean>(true);
    const [status, setStatus] = useState<string>('Loading board…');
    const [loading, setLoading] = useState(false);
    const [myColor, setMyColor] = useState<'white' | 'black' | 'spectator' | null>(null);
    const [isMyTurn, setIsMyTurn] = useState(false);
    const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
    const [subStatus, setSubStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
    const [isPolling, setIsPolling] = useState(false);
    const [gameOutcome, setGameOutcome] = useState<Outcome | null>(null);

    const eventCounter = useRef(0);
    const lastGameState = useRef<bigint>(0n);
    const isPollingRef = useRef(false);
    const myColorRef = useRef<'white' | 'black' | 'spectator' | null>(null);
    const unsubscribeRef = useRef<(() => Promise<unknown>) | null>(null);
    const eventFeedRef = useRef<HTMLDivElement>(null);

    // Keep track of latest state for comparison
    useEffect(() => {
        lastGameState.current = gameState;
    }, [gameState]);

    const appendEvent = useCallback((evt: LiveEvent) => {
        setLiveEvents((prev) => [evt, ...prev].slice(0, 50)); // keep latest 50
        // Auto-scroll
        if (eventFeedRef.current) {
            eventFeedRef.current.scrollTop = 0;
        }
    }, []);

    const refreshBoard = useCallback(async (force = false) => {
        try {
            const data = await gameSDK.getGame(gameId);
            const [gs, p1, p2, p1TurnFromContract] = data;

            if (p1 === '0x0000000000000000000000000000000000000000') return;

            const currentGS = BigInt(gs);
            if (!force && currentGS === lastGameState.current) return;

            console.log('[Sync] Updating state:', currentGS.toString(16));
            setGameState(currentGS);
            setP1Turn(p1TurnFromContract);

            const userAddr = context.account.toLowerCase();
            const color = userAddr === p1.toLowerCase() ? 'white' : (userAddr === p2.toLowerCase() ? 'black' : 'spectator');
            const myTurn = (color === 'white' && p1TurnFromContract) || (color === 'black' && !p1TurnFromContract);

            setIsMyTurn(myTurn);
            setMyColor(color);
            myColorRef.current = color;

            if (color === 'spectator') {
                setStatus(`Spectating #${gameId} — ${p1TurnFromContract ? "White's" : "Black's"} turn`);
            } else {
                setStatus(`You are ${color.toUpperCase()} — ${myTurn ? "Your turn!" : "Opponent's turn"}`);
            }
        } catch (err) {
            console.error('[Sync] Error:', err);
        }
    }, [gameSDK, gameId, context.account]);

    // Load initial board state from contract
    useEffect(() => {
        refreshBoard(true);
    }, [refreshBoard]);



    // ─── @somnia-chain/reactivity WebSocket subscription ─────────────────────
    useEffect(() => {
        let cancelled = false;

        const initSubscription = async () => {
            setSubStatus('connecting');

            const iface = new ethers.Interface([
                'event GameCreated(uint256 gameId, address player1)',
                'event PlayerJoined(uint256 gameId, address player2)',
                'event Move(uint256 gameId, uint256 gameState, uint16 moveValue, bool player1Turn)',
                'event GameEnd(uint256 gameId, uint8 outcome)',
            ]);

            const result = await reactivitySDK.subscribe({
                ethCalls: [],
                eventContractSources: [GAME_ADDRESS],
                topicOverrides: [],
                onlyPushChanges: false,
                onData: (data: SubscriptionCallback) => {
                    if (cancelled) return;

                    const result = data?.result;
                    if (!result || !result.topics || result.topics.length === 0) return;

                    const topic0 = result.topics[0].toLowerCase();
                    const sigGameCreated = ethers.id('GameCreated(uint256,address)').toLowerCase();
                    const sigPlayerJoined = ethers.id('PlayerJoined(uint256,address)').toLowerCase();
                    const sigMove = ethers.id('Move(uint256,uint256,uint16,bool)').toLowerCase();
                    const sigGameEnd = ethers.id('GameEnd(uint256,uint8)').toLowerCase();

                    // Only process if it's one of our events
                    const isOurEvent = [sigGameCreated, sigPlayerJoined, sigMove, sigGameEnd].includes(topic0);
                    if (!isOurEvent) return;

                    const now = new Date().toLocaleTimeString();
                    const id = ++eventCounter.current;

                    try {
                        const parsed = iface.parseLog({
                            topics: [...result.topics],
                            data: result.data
                        });
                        if (!parsed) return;

                        const name = parsed.name;
                        const args = parsed.args;
                        const gId = Number(args.gameId);

                        console.log(`[Reactivity] Event ${name} for game #${gId}`);

                        if (gId === gameId) {
                            // On ANY event for our game, we check if we can update instantly
                            if (name === 'Move') {
                                const newGS = BigInt(args.gameState);
                                const turnFromEvent = args.player1Turn;
                                console.log(`[Reactivity] Instant Move! New state: ${newGS.toString(16)}, Turn: ${turnFromEvent}`);

                                setGameState(newGS);
                                setP1Turn(turnFromEvent);

                                // Update turn indicators instantly using Ref to avoid stale closure
                                const currentRefColor = myColorRef.current;
                                const myTurn = (currentRefColor === 'white' && turnFromEvent) || (currentRefColor === 'black' && !turnFromEvent);

                                setIsMyTurn(myTurn);
                                if (currentRefColor === 'spectator') {
                                    setStatus(`Spectating — ${turnFromEvent ? "White's" : "Black's"} turn`);
                                } else if (currentRefColor) {
                                    setStatus(`You are ${currentRefColor.toUpperCase()} — ${myTurn ? "Your turn!" : "Opponent's turn"}`);
                                }
                                return;
                            }

                            // For other events (Join, End) or as a fallback, poll
                            if (isPollingRef.current) return;

                            const poll = async (retries = 20) => {
                                isPollingRef.current = true;
                                setIsPolling(true);
                                try {
                                    const data = await gameSDK.getGame(gameId);
                                    const [gs, p1, p2, p1TurnFromContract] = data;

                                    const currentGS = BigInt(gs);
                                    const lastGS = BigInt(lastGameState.current);

                                    // If state hasn't changed yet, retry after delay
                                    if (currentGS === lastGS && retries > 0) {
                                        console.log(`[Poll] State still stale (gs: ${currentGS.toString(16)}), retrying... (${retries} left)`);
                                        setTimeout(() => poll(retries - 1), 1000);
                                        return;
                                    }

                                    console.log('[Poll] Found transition or giving up. New GS:', currentGS.toString(16));

                                    setGameState(currentGS);
                                    setP1Turn(p1TurnFromContract);

                                    const userAddr = context.account.toLowerCase();
                                    const color = userAddr === p1.toLowerCase() ? 'white' : (userAddr === p2.toLowerCase() ? 'black' : 'spectator');
                                    const myTurn = (color === 'white' && p1TurnFromContract) || (color === 'black' && !p1TurnFromContract);
                                    setIsMyTurn(myTurn);

                                    if (color === 'spectator') {
                                        setStatus(`Spectating — ${p1TurnFromContract ? "White's" : "Black's"} turn`);
                                    } else {
                                        setStatus(`You are ${color.toUpperCase()} — ${myTurn ? "Your turn!" : "Opponent's turn"}`);
                                    }
                                } catch (err) {
                                    console.error('[Poll] Error:', err);
                                } finally {
                                    isPollingRef.current = false;
                                    setIsPolling(false);
                                }
                            };
                            poll();
                        }

                        let evt: LiveEvent | null = null;
                        if (name === 'GameCreated') {
                            evt = { id, timestamp: now, type: 'GameCreated', label: `Game #${gId} created`, color: 'text-emerald-400' };
                        } else if (name === 'PlayerJoined') {
                            evt = { id, timestamp: now, type: 'PlayerJoined', label: `Player joined #${gId}`, color: 'text-blue-400' };
                        } else if (name === 'Move') {
                            evt = { id, timestamp: now, type: 'Move', label: `Move in #${gId}: ${args.moveValue}`, color: 'text-indigo-400' };
                        } else if (name === 'GameEnd') {
                            const outcome = Number(args.outcome) as Outcome;
                            const outcomeLabel = OUTCOME_LABELS[outcome] ?? `Outcome ${outcome}`;
                            console.log('[Reactivity] GameEnd detected!', { outcome, outcomeLabel, args });
                            evt = { id, timestamp: now, type: 'GameEnd', label: `Game #${gId} ended — ${outcomeLabel}`, color: 'text-amber-400' };
                            if (gId === gameId) {
                                setStatus(`Game Over: ${outcomeLabel}`);
                                setGameOutcome(outcome);
                                setIsMyTurn(false);
                            }
                        }

                        if (evt) appendEvent(evt);
                    } catch (e) {
                        // Not our event or parse error
                    }
                },
                onError: (err: Error) => {
                    console.error('[Reactivity] subscription error:', err);
                    if (!cancelled) setSubStatus('error');
                },
            });

            if (cancelled) return;

            if (result instanceof Error) {
                console.error('[Reactivity] failed to subscribe:', result);
                setSubStatus('error');
            } else {
                unsubscribeRef.current = result.unsubscribe;
                setSubStatus('live');
            }
        };

        initSubscription();

        return () => {
            cancelled = true;
            unsubscribeRef.current?.().catch(console.error);
            unsubscribeRef.current = null;
        };
    }, [reactivitySDK, appendEvent, gameSDK, gameId]);

    // ─── Move handler ─────────────────────────────────────────────────────────
    const handleMove = useCallback(
        async (from: number, to: number) => {
            setLoading(true);
            try {
                setStatus('Sending move…');
                const moveValue = encodeMove(from, to);
                const tx = await gameSDK.move(gameId, moveValue);
                setStatus('Transaction sent, waiting for confirm…');
                await tx.wait();
                setStatus('Move confirmed ⚡');

                // Optimistic refresh
                const data = await gameSDK.getGame(gameId);
                const [gs, p1, p2, p1TurnFromContract] = data;
                setGameState(gs);
                setP1Turn(p1TurnFromContract);
                const userAddr = context.account.toLowerCase();
                const color = userAddr === p1.toLowerCase() ? 'white' : (userAddr === p2.toLowerCase() ? 'black' : 'spectator');
                const myTurn = (color === 'white' && p1TurnFromContract) || (color === 'black' && !p1TurnFromContract);
                setIsMyTurn(myTurn);
            } catch (err) {
                console.error(err);
                setStatus('Invalid move or transaction error.');
            } finally {
                setLoading(false);
            }
        },
        [gameSDK, chessSDK, gameId],
    );

    const subBadge = {
        connecting: { label: '⏳ Connecting…', cls: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' },
        live: { label: '⚡ Live', cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' },
        error: { label: '⚠ Offline', cls: 'bg-red-500/10 border-red-500/20 text-red-400' },
    }[subStatus];

    return (
        <div className="min-h-screen bg-neo-bg text-black font-sans selection:bg-neo-cyan/30">
            <div className="max-w-6xl mx-auto px-4 py-8 lg:py-12">
                {/* Header */}
                <header className="flex flex-col md:flex-row justify-between items-center mb-10 gap-6">
                    <div className="text-center md:text-left">
                        <div className="inline-block border-4 border-black bg-neo-yellow px-4 py-1 shadow-neo mb-2">
                            <h1 className="text-3xl font-black uppercase tracking-tighter text-black">
                                Chess Reactivity
                            </h1>
                        </div>
                        <p className="text-black font-bold text-sm italic">Fully On-Chain Chess Engine</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => refreshBoard(true)}
                            disabled={loading || isPolling}
                            className={`p-3 border-4 border-black bg-white shadow-neo hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all ${isPolling ? 'animate-spin' : ''}`}
                            title="Sync Board State"
                        >
                            🔄
                        </button>
                        <div className="bg-neo-cyan border-4 border-black px-5 py-2 shadow-neo font-black uppercase text-sm">
                            Match #{gameId}
                        </div>
                        <button
                            onClick={onExit}
                            className="neo-btn-pink px-6 py-2 text-sm uppercase"
                        >
                            ← Exit
                        </button>
                    </div>
                </header>

                {/* Main layout */}
                <main className="grid lg:grid-cols-[1fr_380px] gap-10 items-start">
                    {/* Board */}
                    <section className="space-y-6">
                        <div className="bg-white border-8 border-black shadow-neo-xl p-6 md:p-10 relative">
                            {/* Color indicator */}
                            {myColor && (
                                <div className="absolute top-4 left-6 flex items-center gap-2 z-10">
                                    <div className={`w-4 h-4 border-2 border-black ${myColor === 'white' ? 'bg-white' : myColor === 'black' ? 'bg-black' : 'bg-neo-cyan'}`} />
                                    <span className="text-xs font-black uppercase tracking-widest bg-white border-2 border-black px-2 py-0.5">
                                        {myColor === 'spectator' ? 'Spectating' : `Playing as ${myColor}`}
                                    </span>
                                </div>
                            )}
                            <div className="border-4 border-black">
                                <Board
                                    gameState={gameState}
                                    player1Turn={p1Turn}
                                    onMove={handleMove}
                                    disabled={loading || !isMyTurn || !!gameOutcome}
                                    myColor={myColor}
                                />
                            </div>
                        </div>
                        {/* Status bar */}
                        <div
                            className={`text-lg font-black px-6 py-4 border-4 border-black shadow-neo transition-all flex items-center justify-between ${loading || isPolling
                                ? 'bg-neo-cyan'
                                : 'bg-white'
                                }`}
                        >
                            <span className="uppercase">{status}</span>
                            {isPolling && (
                                <span className="text-[10px] font-mono bg-black text-white px-2 py-1 uppercase animate-pulse">
                                    POLLING RPC
                                </span>
                            )}
                        </div>
                    </section>

                    {/* Sidebar */}
                    <aside className="space-y-8">
                        {/* Reactivity Live Feed */}
                        <div className="neo-card bg-white overflow-hidden">
                            {/* Feed header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b-4 border-black bg-neo-cyan">
                                <h2 className="text-lg font-black uppercase tracking-tighter">⚡ Live Events</h2>
                                <span className={`text-xs font-black px-3 py-1 border-2 border-black ${subBadge.cls.replace('/10', '').replace('/20', '')}`}>
                                    {subBadge.label.toUpperCase()}
                                </span>
                            </div>

                            {/* Event list */}
                            <div
                                ref={eventFeedRef}
                                className="flex flex-col gap-0 max-h-80 overflow-y-auto"
                            >
                                {liveEvents.length === 0 ? (
                                    <p className="text-black font-bold text-sm text-center py-12 px-6 italic">
                                        Wait for on-chain events…
                                    </p>
                                ) : (
                                    liveEvents.map((evt) => (
                                        <div
                                            key={evt.id}
                                            className="flex items-start gap-3 px-6 py-4 border-b-2 border-black/10 last:border-0 hover:bg-neo-yellow/10 transition-colors"
                                        >
                                            <span className="bg-black text-white font-mono text-[10px] px-1.5 py-0.5 shrink-0">
                                                {evt.timestamp}
                                            </span>
                                            <span className={`text-sm font-black uppercase leading-tight ${evt.color.replace('text-emerald-400', 'text-emerald-600').replace('text-blue-400', 'text-blue-600').replace('text-indigo-400', 'text-indigo-600').replace('text-amber-400', 'text-amber-600')}`}>
                                                {evt.label}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Sub info */}
                            <div className="px-6 py-4 border-t-4 border-black bg-neo-yellow/20">
                                <p className="text-[10px] text-black font-black font-mono leading-tight uppercase">
                                    Source: {GAME_ADDRESS.slice(0, 16)}…
                                    <br />
                                    Types: Created · Joined · Move · End
                                </p>
                            </div>
                        </div>

                        {/* How to play */}
                        <div className="neo-card p-6 bg-neo-lime/10 space-y-4">
                            <h3 className="text-sm font-black uppercase tracking-widest border-b-2 border-black pb-1 inline-block">How to Play</h3>
                            <ul className="space-y-3 text-sm font-bold">
                                <li className="flex gap-3 items-center">
                                    <span className="bg-neo-yellow border-2 border-black w-6 h-6 flex items-center justify-center shrink-0">1</span>
                                    <span>Click a piece to select</span>
                                </li>
                                <li className="flex gap-3 items-center">
                                    <span className="bg-neo-cyan border-2 border-black w-6 h-6 flex items-center justify-center shrink-0">2</span>
                                    <span>Click target square</span>
                                </li>
                                <li className="flex gap-3 items-center">
                                    <span className="bg-neo-pink border-2 border-black w-6 h-6 flex items-center justify-center shrink-0">3</span>
                                    <span>Validated on-chain</span>
                                </li>
                                <li className="flex gap-3 items-center">
                                    <span className="bg-neo-lime border-2 border-black w-6 h-6 flex items-center justify-center shrink-0">4</span>
                                    <span>Live ⚡ state sync</span>
                                </li>
                            </ul>
                        </div>
                    </aside>
                </main>

                {/* Game Over Overlay */}
                {gameOutcome && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neo-yellow/40 backdrop-blur-sm p-4">
                        <div className="bg-white border-8 border-black p-10 shadow-neo-xl max-w-sm w-full text-center space-y-8 animate-bounce-short">
                            <div className="w-24 h-24 bg-neo-yellow border-4 border-black flex items-center justify-center mx-auto shadow-neo">
                                <span className="text-6xl">
                                    {gameOutcome === 3 ? '🤝' : '🏆'}
                                </span>
                            </div>

                            <div className="space-y-2">
                                <h2 className="text-4xl font-black uppercase tracking-tighter">
                                    Game Over
                                </h2>
                                <div className="bg-black text-white py-2 px-4 inline-block font-black text-xl uppercase">
                                    {OUTCOME_LABELS[gameOutcome]}
                                </div>
                            </div>

                            <p className="text-black font-bold italic">
                                The match on the Somnia chain has concluded.
                                Well played!
                            </p>

                            <button
                                onClick={onExit}
                                className="w-full neo-btn-cyan py-6 text-2xl uppercase"
                            >
                                BACK TO LOBBY
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>

    );
}

declare global {
    interface Window {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ethereum?: any;
    }
}

import { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';
import { GameSDK, ChessSDK } from '../sdk';
import {
    createSomniaPublicClient,
    createSomniaWalletClient,
    createReactivitySDK,
} from '../lib/reactivityClient';
import type { PublicClient, WalletClient } from 'viem';
import type { SDK } from '@somnia-chain/reactivity';

const GAME_ADDRESS = import.meta.env.VITE_GAME_CONTRACT_ADDRESS as `0x${string}`;
const CHESS_ADDRESS = import.meta.env.VITE_CHESS_CONTRACT_ADDRESS as `0x${string}`;
const SUPPORTED_CHAIN_ID = Number(import.meta.env.VITE_SUPPORTED_CHAIN_ID);

export interface GameContext {
    account: string;
    gameSDK: GameSDK;
    chessSDK: ChessSDK;
    reactivitySDK: SDK;
    publicClient: PublicClient;
    walletClient: WalletClient;
}

interface LobbyViewProps {
    onEnterGame: (ctx: GameContext, gameId: number) => void;
}

export function LobbyView({ onEnterGame }: LobbyViewProps) {
    const [account, setAccount] = useState<string | null>(null);
    const [status, setStatus] = useState<string>('Welcome! Connect your wallet to play.');
    const [loading, setLoading] = useState(false);
    const [ctx, setCtx] = useState<GameContext | null>(null);
    const [waitingGameId, setWaitingGameId] = useState<number | null>(null);
    const [isWrongNetwork, setIsWrongNetwork] = useState(false);

    const connectWallet = async () => {
        if (!window.ethereum) {
            setStatus('Please install MetaMask.');
            return;
        }
        try {
            setLoading(true);
            setStatus('Connecting wallet…');

            // Ethers for signing (existing SDK)
            const provider = new ethers.BrowserProvider(window.ethereum);

            const network = await provider.getNetwork();
            const currentChainId = Number(network.chainId);

            if (currentChainId !== SUPPORTED_CHAIN_ID) {
                setIsWrongNetwork(true);
                setStatus('Wrong network. Please switch to the supported chain.');
                setLoading(false);
                return;
            } else {
                setIsWrongNetwork(false);
            }

            const signer = await provider.getSigner();
            const address = (await signer.getAddress()) as `0x${string}`;

            // Viem clients for Reactivity SDK
            const publicClient = createSomniaPublicClient();
            const walletClient = createSomniaWalletClient(address);
            const reactivitySDK = createReactivitySDK(publicClient, walletClient);

            const newCtx: GameContext = {
                account: address,
                gameSDK: GameSDK.connect(GAME_ADDRESS, signer),
                chessSDK: ChessSDK.connect(CHESS_ADDRESS, signer),
                reactivitySDK,
                publicClient,
                walletClient,
            };

            setAccount(address);
            setCtx(newCtx);
            setStatus('Wallet connected. Ready to play!');
        } catch (err) {
            console.error(err);
            setStatus('Connection failed. Try again.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!window.ethereum) return;

        const handleChainChanged = (chainIdHex: string) => {
            const newChainId = Number(chainIdHex);
            if (newChainId !== SUPPORTED_CHAIN_ID) {
                setIsWrongNetwork(true);
                setAccount(null);
                setCtx(null);
                setStatus('Wrong network. Please switch to the supported chain.');
            } else {
                setIsWrongNetwork(false);
                setStatus('Network switched. You can connect now.');
            }
        };

        window.ethereum.on('chainChanged', handleChainChanged);
        return () => {
            window.ethereum.removeListener('chainChanged', handleChainChanged);
        };
    }, []);

    const addNetwork = async () => {
        if (!window.ethereum) return;
        setLoading(true);
        try {
            await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [
                    {
                        chainId: `0x${SUPPORTED_CHAIN_ID.toString(16)}`,
                        rpcUrls: [import.meta.env.VITE_RPC_URL || 'https://0xrpc.io/hoodi'],
                        chainName: 'Somnia Testnet', // Customize as needed
                        nativeCurrency: {
                            name: 'STT',
                            symbol: 'STT',
                            decimals: 18
                        }
                    }
                ]
            });
            setIsWrongNetwork(false);
            connectWallet();
        } catch (addError) {
            console.error(addError);
            setStatus('Failed to add the network.');
        } finally {
            setLoading(false);
        }
    };

    const switchNetwork = async () => {
        if (!window.ethereum) return;
        setLoading(true);
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: `0x${SUPPORTED_CHAIN_ID.toString(16)}` }],
            });
            setIsWrongNetwork(false);
            connectWallet();
        } catch (error) {
            const err = error as { code?: number };
            console.error(err);
            // This error code indicates that the chain has not been added to MetaMask.
            if (err.code === 4902) {
                await addNetwork();
            } else {
                setStatus('Failed to switch network.');
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!ctx) return;

        const iface = new ethers.Interface([
            'event GameCreated(uint256 gameId, address player1)',
            'event PlayerJoined(uint256 gameId, address player2)',
        ]);
        const topicGameCreated = iface.getEvent('GameCreated')!.topicHash;
        const topicPlayerJoined = iface.getEvent('PlayerJoined')!.topicHash;

        let unsub: (() => void) | undefined;

        ctx.reactivitySDK.subscribe({
            ethCalls: [],
            eventContractSources: [GAME_ADDRESS],
            topicOverrides: [],
            onData: (data) => {
                console.log('Data received:', data);
                const result = data.result;
                if (!result.topics || result.topics.length === 0) return;

                const top0 = result.topics[0].toLowerCase();

                if (top0 === topicGameCreated.toLowerCase()) {
                    try {
                        const parsed = iface.parseLog({
                            topics: [...result.topics],
                            data: result.data
                        });
                        // If we are the creator (player1)
                        if (parsed && parsed.args.player1.toLowerCase() === ctx.account.toLowerCase()) {
                            const gameId = Number(parsed.args.gameId);
                            console.log('Detected GameCreated as creator!', { gameId });
                            setWaitingGameId(gameId);
                            setStatus(`Game #${gameId} created! Waiting for opponent…`);
                        }
                    } catch (e) {
                        console.error('Decode GameCreated error:', e);
                    }
                } else if (top0 === topicPlayerJoined.toLowerCase()) {
                    try {
                        const parsed = iface.parseLog({
                            topics: [...result.topics],
                            data: result.data
                        });
                        console.log('Parsed PlayerJoined:', parsed);
                        if (parsed) {
                            const gameId = Number(parsed.args.gameId);
                            console.log('Detected PlayerJoined!', { gameId });

                            // If we are waiting for this specific game to start
                            setWaitingGameId(prev => {
                                if (prev === gameId) {
                                    setStatus(`Opponent joined Game #${gameId}! Entering…`);
                                    setTimeout(() => onEnterGame(ctx, gameId), 800);
                                    return null; // Stop waiting
                                }
                                return prev;
                            });
                        }
                    } catch (e) {
                        console.error('Decode PlayerJoined error:', e);
                    }
                }
            },
        }).then((res) => {
            console.log('Subscription result:', res);
            if (!(res instanceof Error)) {
                unsub = () => res.unsubscribe();
            }
        });

        return () => {
            if (unsub) unsub();
        };
    }, [ctx, onEnterGame])

    const createGame = useCallback(async () => {

        if (!ctx) return;
        setLoading(true);
        try {
            setStatus('Sending createGame transaction…');
            await ctx.gameSDK.createGame();
            setStatus('Waiting for confirmation…');
            // const receipt = await tx.wait();
            // // Parse GameCreated event to extract game ID
            // const iface = new ethers.Interface([
            //     'event GameCreated(uint256 gameId, address player1)',
            // ]);
            // let gameId = 0;
            // for (const log of receipt?.logs ?? []) {
            //     try {
            //         const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
            //         if (parsed?.name === 'GameCreated') {
            //             gameId = Number(parsed.args.gameId);
            //             break;
            //         }
            //     } catch {
            //         // not this log
            //     }
            // }



            // setStatus(`Game #${gameId} created!`);
            // onEnterGame(ctx, gameId);
        } catch (err) {
            console.error(err);
            setStatus('Failed to create game.');
        } finally {
            setLoading(false);
        }
    }, [ctx, onEnterGame]);

    const joinGame = useCallback(async () => {
        const idStr = prompt('Enter Game ID to join:');
        if (!idStr || !ctx) return;
        const gameId = Number(idStr);
        if (isNaN(gameId)) return;
        setLoading(true);
        try {
            setStatus(`Joining game #${gameId}…`);
            const tx = await ctx.gameSDK.joinGame(gameId);
            await tx.wait();
            setStatus(`Joined game #${gameId}!`);
            onEnterGame(ctx, gameId);
        } catch (err) {
            console.error(err);
            setStatus('Failed to join game.');
        } finally {
            setLoading(false);
        }
    }, [ctx, onEnterGame]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-4">
            {/* Logo */}
            <div className="mb-12 text-center">
                <h1 className="text-6xl font-black tracking-tight mb-3 bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-600 bg-clip-text text-transparent">
                    Chess Reactivity
                </h1>
                <p className="text-slate-400 text-lg">
                    Fully on-chain chess powered by{' '}
                    <span className="text-indigo-400 font-semibold">Somnia Reactivity</span>
                </p>
            </div>

            {/* Card */}
            <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-white/5 rounded-3xl p-8 shadow-2xl space-y-6">
                {/* Status */}
                <div
                    className={`text-sm px-4 py-3 rounded-xl border transition-colors ${loading
                        ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                >
                    <span className="font-mono">{loading ? '⏳' : '💬'}</span>{' '}
                    {status}
                </div>

                {!account && !isWrongNetwork ? (
                    <button
                        onClick={connectWallet}
                        disabled={loading}
                        className="w-full py-4 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50 rounded-2xl font-bold text-lg shadow-lg shadow-indigo-900/30 transition-all active:scale-95"
                    >
                        Connect Wallet
                    </button>
                ) : isWrongNetwork ? (
                    <div className="space-y-4">
                        <button
                            onClick={switchNetwork}
                            disabled={loading}
                            className="w-full py-4 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 disabled:opacity-50 rounded-2xl font-bold text-lg shadow-lg shadow-rose-900/30 transition-all active:scale-95"
                        >
                            Switch to Supported Network
                        </button>
                        <button
                            onClick={addNetwork}
                            disabled={loading}
                            className="w-full py-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-2xl font-bold transition-all border border-slate-700"
                        >
                            Add Network
                        </button>
                    </div>
                ) : account ? (
                    <div className="space-y-4">
                        {/* Account badge */}
                        <div className="flex items-center gap-3 bg-slate-950 border border-slate-800 px-4 py-3 rounded-2xl">
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="font-mono text-sm text-slate-300">
                                {account.slice(0, 8)}…{account.slice(-6)}
                                {waitingGameId && <span className="ml-2 text-indigo-400">(Waiting for #${waitingGameId})</span>}
                            </span>
                        </div>

                        <button
                            onClick={createGame}
                            disabled={loading || waitingGameId !== null}
                            className="w-full py-4 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50 rounded-2xl font-bold shadow-lg transition-all active:scale-95"
                        >
                            {waitingGameId ? '⏳ Waiting for Player 2...' : '♛ Create Match'}
                        </button>

                        <button
                            onClick={joinGame}
                            disabled={loading || waitingGameId !== null}
                            className="w-full py-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-2xl font-bold transition-all border border-slate-700"
                        >
                            ♟ Join with ID
                        </button>
                    </div>
                ) : null}

                {/* Network badge */}
                <div className="flex items-center gap-3 pt-2 border-t border-slate-800 text-slate-500 text-sm">
                    <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300">H</div>
                    <span>Somnia Testnet</span>
                </div>
            </div>
        </div>
    );
}

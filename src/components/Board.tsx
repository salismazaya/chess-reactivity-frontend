import { useState, useEffect, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, type Square } from 'chess.js';
import { squareToIndex } from '../sdk';
import { stateToFen } from '../lib/chessUtils';

interface BoardProps {
    gameState: bigint;
    player1Turn: boolean;
    onMove: (from: number, to: number) => void;
    disabled?: boolean;
    myColor?: 'white' | 'black' | 'spectator' | null;
}

export function Board({ gameState, player1Turn, onMove, disabled, myColor }: BoardProps) {
    const [game, setGame] = useState(new Chess());

    // States for click-to-move and highlight
    const [moveFrom, setMoveFrom] = useState("");
    const [optionSquares, setOptionSquares] = useState<Record<string, React.CSSProperties>>({});
    const optionSquaresPersist = useRef<Record<string, React.CSSProperties>>({});

    // Sync local simulation with on-chain state whenever it changes
    useEffect(() => {
        const onChainFen = stateToFen(gameState, player1Turn);

        try {
            const normalizedOnChain = new Chess(onChainFen).fen();
            const normalizedLocal = new Chess(game.fen()).fen();

            if (normalizedLocal === normalizedOnChain) {
                return;
            }

            console.log('Syncing board with on-chain FEN:', normalizedOnChain);
            setGame(new Chess(normalizedOnChain));
        } catch (e) {
            console.error('FEN normalization/sync error:', e);
        }
    }, [gameState, player1Turn]);

    // Update check/checkmate styles when `game` changes
    useEffect(() => {
        optionSquaresPersist.current = {};

        // Find the king of the side to move
        let currentKingSquare: string | null = null;
        const turn = game.turn();

        const board = game.board();
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (piece && piece.type === 'k' && piece.color === turn) {
                    const files = "abcdefgh";
                    currentKingSquare = `${files[c]}${8 - r}`;
                    break;
                }
            }
            if (currentKingSquare) break;
        }

        if (currentKingSquare) {
            if (game.isCheckmate()) {
                optionSquaresPersist.current[currentKingSquare] = {
                    background: "#FF0000",
                    border: "4px solid black",
                    boxSizing: "border-box"
                };
            } else if (game.isCheck()) {
                optionSquaresPersist.current[currentKingSquare] = {
                    background: "#FF69B4",
                    border: "4px solid black",
                    boxSizing: "border-box"
                };
            }

        }

        setOptionSquares(optionSquaresPersist.current);
        setMoveFrom("");
    }, [game.fen()]);

    function getMoveOptions(square: string) {
        const moves = game.moves({
            square: square as Square,
            verbose: true,
        });

        if (moves.length === 0) {
            setOptionSquares(optionSquaresPersist.current);
            return false;
        }

        const newSquares: Record<string, React.CSSProperties> = {};

        for (const move of moves) {
            newSquares[move.to] = {
                background:
                    game.get(move.to as Square) &&
                        game.get(move.to as Square)?.color !== game.get(square as Square)?.color
                        ? "radial-gradient(circle, rgba(0,0,0,.4) 85%, transparent 15%)"
                        : "radial-gradient(circle, rgba(0,0,0,.4) 25%, transparent 25%)",
                borderRadius: "50%",
            };
        }

        newSquares[square] = {
            background: "#00FFFF", // Bright cyan
            border: "4px solid black",
            boxSizing: "border-box"
        };

        setOptionSquares({ ...optionSquaresPersist.current, ...newSquares });


        return true;
    }

    async function onSquareClick({ square }: { square: string }) {
        if (disabled || !myColor || myColor === 'spectator') {
            return;
        }

        const myTurnChar = myColor === 'white' ? 'w' : 'b';
        const squarePiece = game.get(square as Square);

        // Piece clicked to move
        if (!moveFrom && squarePiece) {
            if (squarePiece.color !== myTurnChar) {
                return;
            }

            const hasMoveOptions = getMoveOptions(square);

            if (hasMoveOptions) {
                setMoveFrom(square);
            }
            return;
        }

        // Square clicked to move to, check if valid
        const moves = game.moves({
            square: moveFrom as Square,
            verbose: true,
        });
        const foundMove = moves.find((m) => m.from === moveFrom && m.to === square);

        if (!foundMove) {
            // Check if clicked on new piece
            const hasMoveOptions = squarePiece && squarePiece.color === myTurnChar ? getMoveOptions(square) : false;
            setMoveFrom(hasMoveOptions ? square : "");
            if (!hasMoveOptions) {
                setOptionSquares(optionSquaresPersist.current);
            }
            return;
        }

        // It is a valid move
        try {
            const move = game.move({
                from: moveFrom,
                to: square,
                promotion: 'q',
            });

            if (move === null) {
                console.log('Invalid move in local simulation');
                return;
            }

            const fromIdx = squareToIndex(moveFrom);
            const toIdx = squareToIndex(square);
            console.log(`Simulated move OK: ${moveFrom}->${square}. Broadcasting to chain...`);

            setGame(new Chess(game.fen()));
            onMove(fromIdx, toIdx);

        } catch (e) {
            console.error('Simulation error:', e);
            const hasMoveOptions = squarePiece && squarePiece.color === myTurnChar ? getMoveOptions(square) : false;
            setMoveFrom(hasMoveOptions ? square : "");
            return;
        }

        setMoveFrom("");
        setOptionSquares(optionSquaresPersist.current);
    }

    const orientation = myColor === 'black' ? 'black' : 'white';

    return (
        <div className="w-full aspect-square max-w-[600px] mx-auto">
            <Chessboard
                options={{
                    position: game.fen(),
                    onSquareClick: onSquareClick,
                    boardOrientation: orientation,
                    allowDragging: false,
                    showAnimations: true,
                    darkSquareStyle: { backgroundColor: '#FF69B4' },
                    lightSquareStyle: { backgroundColor: '#FFFFFF' },
                    squareStyles: optionSquares,
                    animationDurationInMs: 200,
                }}
            />
        </div>

    );
}

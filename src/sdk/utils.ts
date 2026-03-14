/**
 * Chess piece type constants
 */
export const PieceType = {
    Empty: 0,
    Pawn: 1,
    Bishop: 2,
    Knight: 3,
    Rook: 4,
    Queen: 5,
    King: 6,
} as const;

export type PieceType = (typeof PieceType)[keyof typeof PieceType];

/**
 * Encodes a chess move into the 16-bit format used by the smart contract.
 * format: [4 bits extra (promotion)] [6 bits from] [6 bits to]
 */
export function encodeMove(from: number, to: number, extra: number = 0): number {
    return ((extra & 0xf) << 12) | ((from & 0x3f) << 6) | (to & 0x3f);
}

/**
 * Decodes a 16-bit move into its components.
 */
export function decodeMove(move: number): { from: number; to: number; extra: number } {
    return {
        from: (move >> 6) & 0x3f,
        to: move & 0x3f,
        extra: (move >> 12) & 0xf,
    };
}

/**
 * Converts a square in algebraic notation (e.g., 'e2') to a 0-63 index.
 */
export function squareToIndex(square: string): number {
    if (!/^[a-h][1-8]$/.test(square)) {
        throw new Error(`Invalid square: ${square}`);
    }
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(square[1]) - 1;
    return rank * 8 + file;
}

/**
 * Converts a 0-63 index to algebraic notation (e.g., 12 -> 'e2').
 */
export function indexToSquare(index: number): string {
    if (index < 0 || index > 63) {
        throw new Error(`Invalid index: ${index}`);
    }
    const file = String.fromCharCode('a'.charCodeAt(0) + (index % 8));
    const rank = Math.floor(index / 8) + 1;
    return `${file}${rank}`;
}

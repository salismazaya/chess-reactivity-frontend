export function stateToFen(gameState: bigint | string | number, player1Turn: boolean): string {
    const gs = BigInt(gameState);
    const ranks: string[] = [];

    const pieceMap: Record<number, string> = {
        1: 'p', // Pawn
        2: 'b', // Bishop
        3: 'n', // Knight
        4: 'r', // Rook
        5: 'q', // Queen
        6: 'k', // King
    };

    for (let r = 7; r >= 0; r--) {
        let rankStr = '';
        let emptyCount = 0;

        for (let f = 0; f < 8; f++) {
            const index = r * 8 + f;
            const bits = Number((gs >> BigInt(index * 4)) & BigInt(0xf));

            if (bits === 0) {
                emptyCount++;
            } else {
                if (emptyCount > 0) {
                    rankStr += emptyCount;
                    emptyCount = 0;
                }
                const type = bits & 0x7;
                const isBlack = (bits & 0x8) !== 0;
                let char = pieceMap[type] || '?';
                rankStr += isBlack ? char.toLowerCase() : char.toUpperCase();
            }
        }

        if (emptyCount > 0) {
            rankStr += emptyCount;
        }
        ranks.push(rankStr);
    }

    const turn = player1Turn ? 'w' : 'b';
    return `${ranks.join('/')} ${turn} - - 0 1`;
}

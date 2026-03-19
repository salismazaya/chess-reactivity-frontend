import { ethers } from "ethers";

export const GAME_ABI = [
    "constructor()",
    "event GameCreated(uint256 gameId, address player1)",
    "event PlayerJoined(uint256 gameId, address player2)",
    "event Move(uint256 gameId, uint256 gameState, uint16 moveValue, bool player1Turn)",
    "event GameEnd(uint256 gameId, uint8 outcome)",
    "function createGame() public",
    "function joinGame(uint256 gId) public",
    "function move(uint256 gId, uint16 moveValue) public",
    "function getGame(uint256 gId) public view returns (uint256 gameState, address player1, address player2, bool player1Turn)",
    "function getMoves(uint256 gId) public view returns (uint16[] memory)",
    "function authorize(address session) public",
    "function sessionToMain(address session) public view returns (address)",
];

export const CHESS_ABI = [
    "function game_state_start() public view returns (uint256)",
    "function initial_white_state() public view returns (uint32)",
    "function initial_black_state() public view returns (uint32)",
    "function pieceAtPosition(uint256 gameState, uint8 pos) public pure returns (uint8)",
    "function verifyExecuteMove(uint256 gameState, uint16 move, uint32 playerState, uint32 opponentState, bool currentTurnBlack) public pure returns (uint256, uint32, uint32)",
    "function checkEndgame(uint256 gameState, uint32 playerState, uint32 opponentState) public pure returns (uint8)",
];

export class ChessSDK {
    public contract: ethers.Contract;
    constructor(contract: ethers.Contract) {
        this.contract = contract;
    }

    static connect(address: string, runner: ethers.ContractRunner): ChessSDK {
        const contract = new ethers.Contract(address, CHESS_ABI, runner);
        return new ChessSDK(contract);
    }

    async getStartState(): Promise<bigint> {
        return await this.contract.game_state_start();
    }

    async getInitialWhiteState(): Promise<number> {
        return Number(await this.contract.initial_white_state());
    }

    async getInitialBlackState(): Promise<number> {
        return Number(await this.contract.initial_black_state());
    }
}

export class GameSDK {
    public contract: ethers.Contract;
    constructor(contract: ethers.Contract) {
        this.contract = contract;
    }

    static connect(address: string, runner: ethers.ContractRunner): GameSDK {
        const contract = new ethers.Contract(address, GAME_ABI, runner);
        return new GameSDK(contract);
    }

    async createGame(): Promise<ethers.ContractTransactionResponse> {
        return await this.contract.createGame();
    }

    async joinGame(gameId: bigint | number): Promise<ethers.ContractTransactionResponse> {
        return await this.contract.joinGame(gameId);
    }

    async move(gameId: bigint | number, moveValue: number): Promise<ethers.ContractTransactionResponse> {
        return await this.contract.move(gameId, moveValue);
    }

    async getGame(gameId: bigint | number): Promise<[bigint, string, string, boolean]> {
        return await this.contract.getGame(gameId);
    }

    async getMoves(gameId: bigint | number): Promise<number[]> {
        return await this.contract.getMoves(gameId);
    }

    async authorize(session: string): Promise<ethers.ContractTransactionResponse> {
        return await this.contract.authorize(session);
    }

    async sessionToMain(session: string): Promise<string> {
        return await this.contract.sessionToMain(session);
    }
}

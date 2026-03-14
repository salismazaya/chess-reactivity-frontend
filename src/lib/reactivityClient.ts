import {
    createPublicClient,
    createWalletClient,
    http,
    webSocket,
    defineChain,
    type WalletClient,
    type PublicClient,
} from 'viem';
import { SDK } from '@somnia-chain/reactivity';

const RPC_URL = import.meta.env.VITE_RPC_URL as string;
const WS_RPC_URL = import.meta.env.VITE_WS_RPC_URL as string || 'wss://dream-rpc.somnia.network/ws';

/**
 * Somnia Testnet chain definition for viem.
 */
export const somniaTestnet = defineChain({
    id: 50312,
    name: 'Somnia Testnet',
    nativeCurrency: {
        name: 'SOM',
        symbol: 'SOM',
        decimals: 18,
    },
    rpcUrls: {
        default: {
            http: [RPC_URL],
            webSocket: [WS_RPC_URL],
        },
    },
    testnet: true,
});

/**
 * Create a viem PublicClient for the Somnia Testnet.
 * Used for read-only contract interactions and as the base for the SDK.
 * Reactivity SDK REQUIRES webSocket transport for subscriptions.
 */
export function createSomniaPublicClient(): PublicClient {
    return createPublicClient({
        chain: somniaTestnet,
        transport: webSocket(WS_RPC_URL),
    }) as PublicClient;
}

/**
 * Create a viem WalletClient for the Somnia Testnet.
 * Used for sending transactions (createGame, joinGame, move).
 */
export function createSomniaWalletClient(account: `0x${string}`): WalletClient {
    return createWalletClient({
        account,
        chain: somniaTestnet,
        transport: http(RPC_URL),
    });
}

/**
 * Create a @somnia-chain/reactivity SDK instance.
 * The SDK requires a viem publicClient (with websocket for subscriptions)
 * and optionally a walletClient.
 */
export function createReactivitySDK(
    publicClient: PublicClient,
    walletClient?: WalletClient,
): SDK {
    return new SDK({
        public: publicClient,
        wallet: walletClient ?? undefined,
    });
}

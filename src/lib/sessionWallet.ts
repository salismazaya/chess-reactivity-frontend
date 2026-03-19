import { ethers } from 'ethers';

const SESSION_WALLET_KEY = 'chess_session_wallet_pk';

export class SessionWallet {
    private wallet: any = null;

    constructor() {
        const pk = localStorage.getItem(SESSION_WALLET_KEY);
        if (pk) {
            try {
                this.wallet = new ethers.Wallet(pk);
            } catch (e) {
                console.error('Failed to load session wallet:', e);
                localStorage.removeItem(SESSION_WALLET_KEY);
            }
        }
    }

    get address(): string | null {
        return this.wallet?.address || null;
    }

    get signer(): ethers.Signer | null {
        return this.wallet;
    }

    create(): ethers.Signer {
        const newWallet = ethers.Wallet.createRandom();
        localStorage.setItem(SESSION_WALLET_KEY, newWallet.privateKey);
        this.wallet = newWallet;
        return newWallet;
    }

    connect(provider: ethers.Provider): ethers.Signer | null {
        if (this.wallet) {
            return this.wallet.connect(provider);
        }
        return null;
    }

    clear() {
        localStorage.removeItem(SESSION_WALLET_KEY);
        this.wallet = null;
    }
}

export const sessionWallet = new SessionWallet();

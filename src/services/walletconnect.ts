import SignClient from '@walletconnect/sign-client';
import { sendNanoContractTxRpcRequest } from '@hathor/hathor-rpc-handler';
import { WalletConnectModal } from '@walletconnect/modal';
import { ACTIVE_HATHOR_NETWORK } from '../config/network';

// WalletConnect Project ID - Get yours at https://cloud.walletconnect.com
const PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';
const STORAGE_PREFIX = `poll-${ACTIVE_HATHOR_NETWORK.chainId.replace(':', '-')}`;
const HATHOR_WALLET_DEEP_LINK_SCHEME = 'hathorwallet';

// Required methods for Hathor wallet - match pXiel exactly
const REQUIRED_METHODS = ['htr_signWithAddress', 'htr_sendNanoContractTx'];
const OPTIONAL_METHODS = ['htr_createToken', 'htr_sendTransaction'];
const MOBILE_APPROVAL_METHODS = new Set([...REQUIRED_METHODS, ...OPTIONAL_METHODS]);

export interface WalletConnectState {
    client: SignClient | null;
    session: any | null;
    address: string | null;
    connected: boolean;
}

type GlobalWcStore = typeof globalThis & {
    __pollWcClient?: SignClient | null;
    __pollWcSession?: any | null;
    __pollWcModal?: WalletConnectModal | null;
};

const globalWcStore = globalThis as GlobalWcStore;

let signClient: SignClient | null = globalWcStore.__pollWcClient || null;
let currentSession: any = globalWcStore.__pollWcSession || null;
let wcModal: WalletConnectModal | null = globalWcStore.__pollWcModal || null;

const syncGlobalWcStore = () => {
    globalWcStore.__pollWcClient = signClient;
    globalWcStore.__pollWcSession = currentSession;
    globalWcStore.__pollWcModal = wcModal;
};

const getHathorNamespace = (session: any): any => {
    if (!session?.namespaces) return null;
    if (session.namespaces.hathor) return session.namespaces.hathor;
    if (session.namespaces.htr) return session.namespaces.htr;

    // Fallback: search all namespaces for one that contains Hathor accounts
    for (const ns of Object.values(session.namespaces) as any[]) {
        if (ns.accounts?.some((acc: string) => acc.startsWith('hathor:'))) {
            return ns;
        }
    }
    return null;
};

const sessionMatchesActiveChain = (session: any): boolean => {
    const hathor = getHathorNamespace(session) || {};
    const chains = hathor.chains || [];
    const accounts = hathor.accounts || [];

    return chains.includes(ACTIVE_HATHOR_NETWORK.chainId) ||
        accounts.some((account: string) => account.startsWith(`${ACTIVE_HATHOR_NETWORK.chainId}:`));
};

const isMobileWalletConnectFlow = () => {
    if (typeof window === 'undefined') return false;

    return /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent);
};

const getSessionRequestDeepLink = (session: any): string => {
    const nativeRedirect = session?.peer?.metadata?.redirect?.native;
    if (typeof nativeRedirect === 'string' && nativeRedirect.trim()) {
        return nativeRedirect.trim();
    }

    if (session?.topic) {
        return `${HATHOR_WALLET_DEEP_LINK_SCHEME}://wc?uri=${encodeURIComponent(`wc:${session.topic}@2`)}`;
    }

    return `${HATHOR_WALLET_DEEP_LINK_SCHEME}://`;
};

const openHathorWalletDeepLink = (wcUri?: string, session?: any) => {
    if (typeof window === 'undefined') return;

    const deepLink = wcUri
        ? `${HATHOR_WALLET_DEEP_LINK_SCHEME}://wc?uri=${encodeURIComponent(wcUri)}`
        : getSessionRequestDeepLink(session);
    window.location.href = deepLink;
};

export const WalletConnectService = {
    /**
     * Initialize the WalletConnect Sign Client and Modal
     */
    async init(): Promise<SignClient> {
        if (signClient) return signClient;

        // Initialize the WalletConnectModal - like pXiel does
        const modalConfig = {
            projectId: PROJECT_ID,
            walletConnectVersion: 2,
            standaloneChains: [ACTIVE_HATHOR_NETWORK.chainId],
        } as unknown as ConstructorParameters<typeof WalletConnectModal>[0];
        wcModal = new WalletConnectModal(modalConfig);

        signClient = await SignClient.init({
            projectId: PROJECT_ID,
            relayUrl: 'wss://relay.reown.com',
            customStoragePrefix: STORAGE_PREFIX,
            metadata: {
                name: 'Hathor Polls',
                description: `Token-weighted polls on ${ACTIVE_HATHOR_NETWORK.name}`,
                url: window.location.origin,
                icons: ['https://walletconnect.com/walletconnect-logo.png'] // Match pXiel's remote icon
            }
        });

        // Setup event handlers
        signClient.on('session_update', ({ topic, params }) => {
            const updated = signClient?.session.get(topic);
            if (updated) {
                currentSession = { ...updated, namespaces: params?.namespaces || updated.namespaces };
                syncGlobalWcStore();
            }
        });

        signClient.on('session_delete', () => {
            console.log('Session deleted');
            currentSession = null;
            syncGlobalWcStore();
        });

        signClient.on('session_expire', () => {
            console.log('Session expired');
            currentSession = null;
            syncGlobalWcStore();
        });

        syncGlobalWcStore();
        return signClient;
    },

    /**
     * Connect to wallet via WalletConnect
     */
    async connect(): Promise<{ address: string; session: any }> {
        const client = await this.init();

        // Check for existing sessions - validate they have the required methods and chain
        const lastSession = client.session.getAll().pop();
        if (lastSession) {
            const hathorNamespace = this.getHathorNamespace(lastSession);
            const methods = hathorNamespace?.methods || [];
            const matchesActiveChain = sessionMatchesActiveChain(lastSession);

            if (methods.includes('htr_sendNanoContractTx') && matchesActiveChain) {
                currentSession = lastSession;
                syncGlobalWcStore();
                const address = this.getAddressFromSession(lastSession);
                console.log('[WC] Restored valid session with methods:', methods);
                return { address, session: lastSession };
            } else {
                // Session is stale, disconnect it and create new one
                console.log('[WC] Stale session found (missing methods or wrong chain), disconnecting...', {
                    methods,
                    chains: hathorNamespace?.chains || [],
                    accounts: hathorNamespace?.accounts || [],
                    expectedChain: ACTIVE_HATHOR_NETWORK.chainId,
                });
                try {
                    await client.disconnect({
                        topic: lastSession.topic,
                        reason: { code: 6000, message: 'Session missing required methods or chain' }
                    });
                } catch (e) {
                    console.log('[WC] Failed to disconnect stale session:', e);
                }
            }
        }

        // Match the working apps: a single Hathor namespace with the full method set.
        const requestedMethods = Array.from(new Set([...REQUIRED_METHODS, ...OPTIONAL_METHODS]));
        const requiredNamespaces = {
            hathor: {
                methods: requestedMethods,
                chains: [ACTIVE_HATHOR_NETWORK.chainId],
                events: [],
            },
        };

        const { uri, approval } = await client.connect({
            requiredNamespaces,
        });

        // Use the official WalletConnectModal
        if (uri) {
            if (isMobileWalletConnectFlow()) {
                console.log('[WC] Opening Hathor Wallet deep link');
                openHathorWalletDeepLink(uri);
            } else if (wcModal) {
                console.log('[WC] Opening modal with URI');
                wcModal.openModal({ uri, standaloneChains: requiredNamespaces.hathor.chains });
            }
        }

        try {
            // Wait for wallet approval
            const session = await approval();
            currentSession = session;
            syncGlobalWcStore();
            console.log('[WC] Session approved:', session.namespaces);

            const address = this.getAddressFromSession(session);
            return { address, session };
        } finally {
            // Always close the modal
            wcModal?.closeModal?.();
        }
    },

    /**
     * Disconnect current session
     */
    async disconnect(): Promise<void> {
        if (!signClient || !currentSession) return;

        await signClient.disconnect({
            topic: currentSession.topic,
            reason: { code: 6000, message: 'User disconnected' }
        });
        currentSession = null;
        syncGlobalWcStore();
    },

    /**
     * Get the Hathor namespace from the session (handles 'hathor' or 'htr' keys)
     */
    getHathorNamespace(session: any): any {
        return getHathorNamespace(session);
    },

    /**
     * Extract address from session
     */
    getAddressFromSession(session: any): string {
        const hathor = this.getHathorNamespace(session) || {};
        const accounts = hathor.accounts || [];

        console.log('[WC] Session accounts:', accounts);
        if (accounts.length > 0) {
            // Format: "hathor:<network>:HAddress..."
            const parts = accounts[0].split(':');
            return parts[parts.length - 1];
        }
        return '';
    },

    /**
     * Set/restore the current session (for session recovery)
     */
    setCurrentSession(session: any): void {
        currentSession = session;
        syncGlobalWcStore();
        console.log('[WC] Session restored:', session?.topic);
    },

    restoreSession(): void {
        if (!signClient) return;
        const lastSession = signClient.session.getAll().pop();
        if (!lastSession) {
            currentSession = null;
            syncGlobalWcStore();
            return;
        }

        const hathorNamespace = getHathorNamespace(lastSession);
        const methods = hathorNamespace?.methods || [];
        if (methods.includes('htr_sendNanoContractTx') && sessionMatchesActiveChain(lastSession)) {
            currentSession = lastSession;
        } else {
            currentSession = null;
        }
        syncGlobalWcStore();
    },

    /**
     * Get the active chain ID from session
     */
    getChainFromSession(session: any): string {
        const hathor = this.getHathorNamespace(session) || {};
        const accounts = hathor.accounts || [];
        if (accounts.length > 0) {
            const parts = accounts[0].split(':');
            return `${parts[0]}:${parts[1]}`;
        }
        return ACTIVE_HATHOR_NETWORK.chainId;
    },

    /**
     * Send a JSON-RPC request to the wallet
     */
    async request<T>(method: string, params: any): Promise<T> {
        if (!signClient || !currentSession) {
            this.restoreSession();
        }
        if (!signClient || !currentSession) {
            throw new Error('Not connected to wallet');
        }

        const chainId = this.getChainFromSession(currentSession);
        // Detect which key to use for the request (wallet apps can be picky)
        const namespaceKey = currentSession.namespaces.hathor ? 'hathor' : (currentSession.namespaces.htr ? 'htr' : 'hathor');

        console.log(`[WC] Sending ${method} to ${chainId} using namespace ${namespaceKey}`);

        const requestPromise = signClient.request({
            topic: currentSession.topic,
            chainId,
            request: {
                method,
                params
            }
        }) as Promise<T>;

        if (isMobileWalletConnectFlow() && MOBILE_APPROVAL_METHODS.has(method)) {
            console.log('[WC] Opening Hathor Wallet for mobile request approval');
            openHathorWalletDeepLink(undefined, currentSession);
        }

        return await requestPromise;
    },

    /**
     * Send a Nano Contract transaction
     */
    async signNanoContractTx(txData: {
        ncId?: string | null;
        blueprintId?: string | null;
        method: string;
        args: any[];
        actions?: any[];
    }): Promise<{ txId: string }> {
        // Get blueprint ID from env if not provided
        const blueprintId = txData.blueprintId || import.meta.env.VITE_POLL_BLUEPRINT_ID || '';

        // Use the helper to build properly formatted RPC request
        const rpcRequest = sendNanoContractTxRpcRequest(
            txData.method,
            blueprintId,
            txData.actions || [],
            txData.args || [],
            true,  // pushTx - broadcast the transaction
            txData.ncId || null
        );

        // Add network to params based on active session
        const chainId = this.getChainFromSession(currentSession);
        const network = chainId.split(':')[1] || ACTIVE_HATHOR_NETWORK.chainId.split(':')[1];
        const paramsWithNetwork = {
            ...rpcRequest.params,
            network,
        };

        console.log('[WC] RPC Params:', JSON.stringify(paramsWithNetwork, null, 2));

        let response: any;
        try {
            response = await this.request(rpcRequest.method, paramsWithNetwork);
        } catch (error: any) {
            if (error?.message?.includes('No matching key') || error?.message?.includes('history')) {
                console.warn('[WC] Request history missing. Try reconnecting the wallet and retrying.');
            }
            throw error;
        }
        console.log('[WC] Wallet Response:', JSON.stringify(response, null, 2));

        // Robustly extract transaction ID from various possible response formats
        // Some wallets/versions return hash, some txId, some nest it in 'response'
        let txId = response?.hash ||
            response?.txId ||
            response?.response?.hash ||
            response?.response?.txId ||
            response?.transaction?.hash ||
            null;

        // If we still don't have a string ID, but the response itself is a string, use it
        if (!txId && typeof response === 'string') {
            txId = response;
        }

        console.log('[WC] Extracted txId:', txId);

        return {
            ...response,
            txId: txId
        };
    },

    /**
     * Get wallet balance
     */
    async getBalance(): Promise<{ available: number; locked: number }> {
        return await this.request('htr_getBalance', {});
    },

    /**
     * Get current address
     */
    async getAddress(): Promise<string> {
        return await this.request('htr_getAddress', {});
    },

    /**
     * Open wallet connection modal/deeplink
     */
    openWalletConnectModal(uri: string): void {
        // Create a simple modal with QR code
        const modal = document.createElement('div');
        modal.id = 'wc-modal';
        modal.innerHTML = `
            <div style="
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
            ">
                <div style="
                    background: #111;
                    padding: 2rem;
                    border-radius: 12px;
                    border: 1px solid #333;
                    text-align: center;
                    max-width: 400px;
                ">
                    <h2 style="color: white; margin-bottom: 1rem;">Connect Wallet</h2>
                    <p style="color: #888; margin-bottom: 1.5rem;">
                        Scan this QR code with your Hathor Wallet app
                    </p>
                    <div id="qr-container" style="
                        background: white;
                        padding: 1rem;
                        border-radius: 8px;
                        display: inline-block;
                        margin-bottom: 1.5rem;
                    "></div>
                    <p style="color: #666; font-size: 0.75rem; word-break: break-all; margin-bottom: 1rem;">
                        ${uri.substring(0, 50)}...
                    </p>
                    <button id="wc-copy" style="
                        background: #333;
                        color: white;
                        border: none;
                        padding: 0.75rem 1.5rem;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-right: 0.5rem;
                    ">Copy Link</button>
                    <button id="wc-close" style="
                        background: transparent;
                        color: #888;
                        border: 1px solid #444;
                        padding: 0.75rem 1.5rem;
                        border-radius: 4px;
                        cursor: pointer;
                    ">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Generate QR code using dynamic imports (ES module compatible)
        Promise.all([
            import('qrcode.react'),
            import('react'),
            import('react-dom/client')
        ]).then(([qrModule, React, ReactDOM]) => {
            const container = document.getElementById('qr-container');
            if (container) {
                const root = ReactDOM.createRoot(container);
                root.render(React.createElement(qrModule.QRCodeSVG, { value: uri, size: 200 }));
            }
        });

        // Event handlers
        document.getElementById('wc-copy')?.addEventListener('click', () => {
            navigator.clipboard.writeText(uri);
            alert('Copied to clipboard!');
        });

        document.getElementById('wc-close')?.addEventListener('click', () => {
            modal.remove();
        });
    },

    /**
     * Close the WalletConnect modal
     */
    closeModal(): void {
        wcModal?.closeModal?.();
        document.getElementById('wc-modal')?.remove();
    },

    /**
     * Check if currently connected
     */
    isConnected(): boolean {
        return !!currentSession;
    },

    /**
     * Get current session
     */
    getSession(): any {
        return currentSession;
    }
};

const HATHOR_NAMESPACE = 'hathor';
const DEFAULT_NETWORK_REFERENCE = 'testnet';

export function normalizeChainId(chainLike?: string | null) {
  if (!chainLike) return `${HATHOR_NAMESPACE}:${DEFAULT_NETWORK_REFERENCE}`;

  const trimmed = `${chainLike}`.trim();
  if (!trimmed) return `${HATHOR_NAMESPACE}:${DEFAULT_NETWORK_REFERENCE}`;

  const parts = trimmed.split(':').filter(Boolean);
  if (parts.length >= 2) {
    const [namespace, reference] = parts;
    return `${namespace || HATHOR_NAMESPACE}:${reference || DEFAULT_NETWORK_REFERENCE}`;
  }

  return `${HATHOR_NAMESPACE}:${parts[0] || DEFAULT_NETWORK_REFERENCE}`;
}

const DEFAULT_CHAIN = normalizeChainId(import.meta.env.VITE_HATHOR_CHAIN || DEFAULT_NETWORK_REFERENCE);

type HathorNetworkKey = 'localnet' | 'testnet' | 'mainnet';

interface HathorNetworkConfig {
  key: HathorNetworkKey;
  chainId: `hathor:${string}`;
  name: string;
  rpc: string;
}

const NETWORKS: Record<HathorNetworkKey, HathorNetworkConfig> = {
  localnet: {
    key: 'localnet',
    chainId: 'hathor:privatenet',
    name: 'Hathor Privatenet',
    rpc: 'https://node.localnet.hathor.works/v1a/',
  },
  testnet: {
    key: 'testnet',
    chainId: 'hathor:testnet',
    name: 'Hathor Testnet',
    rpc: 'https://node1.testnet.hathor.network/v1a/',
  },
  mainnet: {
    key: 'mainnet',
    chainId: 'hathor:mainnet',
    name: 'Hathor Mainnet',
    rpc: 'https://node1.mainnet.hathor.network/v1a/',
  },
};

const chainReference = DEFAULT_CHAIN.split(':')[1] || DEFAULT_NETWORK_REFERENCE;

const activeNetworkKey: HathorNetworkKey = chainReference === 'testnet'
  ? 'testnet'
  : chainReference === 'mainnet'
    ? 'mainnet'
    : chainReference === 'privatenet'
      ? 'localnet'
      : 'testnet';

export const ACTIVE_HATHOR_NETWORK = {
  ...NETWORKS[activeNetworkKey],
  chainId: DEFAULT_CHAIN as HathorNetworkConfig['chainId'],
  rpc: import.meta.env.VITE_HATHOR_NODE_URL || NETWORKS[activeNetworkKey].rpc,
};

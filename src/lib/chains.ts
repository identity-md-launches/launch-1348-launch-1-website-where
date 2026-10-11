export type ChainId = 'ethereum' | 'base' | 'robinhood'

export interface Chain {
  id: ChainId
  name: string
  /** EVM chain id, for display only. */
  evmId: number
  /** Keyless Blockscout instance; both the legacy `/api` and `/api/v2` routes are used. */
  explorer: string
  /** Human explorer link for an address. */
  addressUrl: (address: string) => string
}

export const CHAINS: Chain[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    evmId: 1,
    explorer: 'https://eth.blockscout.com',
    addressUrl: (a) => `https://eth.blockscout.com/address/${a}`,
  },
  {
    id: 'base',
    name: 'Base',
    evmId: 8453,
    explorer: 'https://base.blockscout.com',
    addressUrl: (a) => `https://base.blockscout.com/address/${a}`,
  },
  {
    id: 'robinhood',
    name: 'Robinhood Chain',
    evmId: 4663,
    explorer: 'https://robinhoodchain.blockscout.com',
    addressUrl: (a) => `https://robinhoodchain.blockscout.com/address/${a}`,
  },
]

export const CHAIN_BY_ID: Record<ChainId, Chain> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c]),
) as Record<ChainId, Chain>

/** All three chains settle gas in ETH, so every amount on the dashboard is in ETH. */
export const NATIVE_SYMBOL = 'ETH'

/** SwarmExit on Ethereum mainnet (deployment record, launch 1682, source commit 5868d48). */
export const SWARM_EXIT_ADDRESS =
  "0x5c3c2a6d7d340db9f8b3e0cbbc8dbbb7ec73bc61" as const;
/** keccak256 of the key-sorted ABI JSON lives in abi/hash.ts and is checked by web/scripts/check-abi.mjs. */
export { SWARM_EXIT_ABI_HASH } from "./abi/hash.ts";

/** $IMD, the settlement token (chain table pairToken; also a constant of the contract). */
export const IMD_ADDRESS =
  "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7" as const;
export const IMD_SYMBOL = "IMD";
export const IMD_DECIMALS = 18;

/** Treasury receiving the 2% fee (the contract's TREASURY constant). */
export const TREASURY_ADDRESS =
  "0xFC3ad9C531e1736690b2d5f24FebD35ebf051cFB" as const;
/** Fee in basis points, enforced by the contract (SELL_TAX_BPS). */
export const FEE_BPS = 200n;
export const BPS = 10_000n;

/** Per-token minimum IMD = simulated output minus this slippage, in basis points. */
export const SLIPPAGE_BPS = 300n;
/** Seconds a sell transaction stays valid. */
export const DEADLINE_SECONDS = 600;
/** Fallback when MAX_TOKENS_PER_SALE cannot be read. */
export const DEFAULT_MAX_TOKENS_PER_SALE = 50;

export const EXPLORER_URL = "https://etherscan.io";

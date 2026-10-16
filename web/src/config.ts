// The site's single configuration file: addresses, chain, RPCs and wallet connectors.
// Addresses come from the launch's verified deployment record and the chain table;
// nothing here is invented and nothing needs an account.
import { createConfig, http, fallback } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { chain, RPC_URLS } from "./chain";

export const SITE_NAME = "SwarmSweep";
export const SITE_DESCRIPTION =
  "Find live Uniswap v4 routes for your Ethereum swarm tokens. Select tokens and sell for IMD without registration; 2% of proceeds go to the treasury.";
export const SITE_URL = "./";
export const SITE_ICON_URL = "./favicon.svg";

export * from "./deployment";

export const config = createConfig({
  chains: [chain],
  // EIP-6963 discovery lists every installed extension under its own name
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), coinbaseWallet({ appName: SITE_NAME })],
  transports: {
    [chain.id]: fallback(
      RPC_URLS.map((url) => http(url, { timeout: 12000, retryCount: 1 })),
    ),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}

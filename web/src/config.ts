// The site's single configuration file: addresses, chain, RPCs and wallet connectors.
// Addresses come from the launch's verified deployment record and the chain table;
// nothing here is invented and nothing needs an account.
import { createConfig, http, fallback } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { chain, RPC_URLS } from "./chain";

export const SITE_NAME = "SweepDust";
export const SITE_DESCRIPTION =
  "Turn your Ethereum token dust into IMD. Scan your wallet, filter by value, and sweep selected tokens in a batch. A 2% fee applies to proceeds.";
export const SITE_URL = "https://sweepdust.sites.imd.fun";
export const SITE_ICON_URL = "./favicon.svg";

export * from "./deployment";

export const config = createConfig({
  chains: [chain],
  batch: { multicall: { wait: 20, batchSize: 16384 } },
  // EIP-6963 discovery lists every installed extension under its own name
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), coinbaseWallet({ appName: SITE_NAME })],
  transports: {
    [chain.id]: fallback(
      RPC_URLS.map((url) => http(url, { timeout: 10000, retryCount: 0, batch: { wait: 20, batchSize: 24 } })),
    ),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}

// Consolidated network configuration
// Set NEXT_PUBLIC_NETWORK to "mainnet" for production
// Validator endpoints: https://docs.magicblock.gg/pages/overview/products

export type Network = "devnet" | "mainnet";

export const NETWORK: Network = (process.env.NEXT_PUBLIC_NETWORK as Network) || "devnet";

// MagicBlock base chain RPC (init, delegate, etc.)
export const RPC_URL =
  NETWORK === "mainnet"
    ? "https://mainnet.helius-rpc.com/?api-key=ff17a075-ee9d-4796-b9d5-3d0a054f017c"
    : "https://devnet-router.magicblock.app";

// Ephemeral Rollup RPC - direct validator endpoints (devnet: as/eu/us, mainnet: as/eu/us)
export const ER_RPC_URL =
  NETWORK === "mainnet" ? "https://us.magicblock.app" : "https://devnet-as.magicblock.app";

// Magic Router - single endpoint that routes txs to ER or base layer based on delegation
// Use for transfer: correct blockhash + auto-routing
export const ER_ROUTER_URL =
  NETWORK === "mainnet" ? "https://router.magicblock.app" : "https://devnet-router.magicblock.app";

export const MAGICBLOCK_API_URL = "https://api.docs.magicblock.app";

export const SOLANA_CLUSTER: "mainnet-beta" | "devnet" =
  NETWORK === "mainnet" ? "mainnet-beta" : "devnet";

// TEE validator (devnet) - https://docs.magicblock.gg/pages/overview/products
export const MAGICBLOCK_VALIDATOR = "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA";

export function getSolscanUrl(signature: string): string {
  const base = `https://solscan.io/tx/${signature}`;
  return NETWORK === "devnet" ? `${base}?cluster=devnet` : base;
}

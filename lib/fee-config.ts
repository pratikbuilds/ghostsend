/**
 * Fee config and calculations matching privacycash SDK (withdraw.ts / withdrawSPL.ts).
 * Deposit has no relayer fee (deposit.ts / depositSPL.ts use fee = 0).
 * Config is fetched from relayer API; fallback used if fetch fails.
 */

import { LAMPORTS_PER_SOL } from "@solana/web3.js";

const RELAYER_API_URL =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_RELAYER_API_URL
    ? process.env.NEXT_PUBLIC_RELAYER_API_URL
    : "https://api3.privacycash.org";

export type RelayerConfig = {
  withdraw_fee_rate: number;
  withdraw_rent_fee: number;
  rent_fees: Record<string, number>;
  minimum_withdrawal: Record<string, number>;
};

let configCache: RelayerConfig | null = null;

/** Fetch relayer config (same source as SDK getConfig). */
export async function getRelayerConfig(): Promise<RelayerConfig | null> {
  if (configCache) return configCache;
  try {
    const res = await fetch(`${RELAYER_API_URL}/config`);
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    configCache = {
      withdraw_fee_rate: Number(raw.withdraw_fee_rate) || 0.0035,
      withdraw_rent_fee: Number(raw.withdraw_rent_fee) ?? 0.006,
      rent_fees:
        typeof raw.rent_fees === "object" && raw.rent_fees !== null
          ? (raw.rent_fees as Record<string, number>)
          : {},
      minimum_withdrawal:
        typeof raw.minimum_withdrawal === "object" && raw.minimum_withdrawal !== null
          ? (raw.minimum_withdrawal as Record<string, number>)
          : {},
    };
    return configCache;
  } catch {
    return null;
  }
}

/** Fallback config when relayer is unavailable (match docs: 0.35% + 0.006 SOL/recipient). */
const FALLBACK: RelayerConfig = {
  withdraw_fee_rate: 0.0035,
  withdraw_rent_fee: 0.006,
  rent_fees: {},
  minimum_withdrawal: {},
};

/**
 * Compute total lamports to deduct from private balance so recipient receives amountToRecipientLamports.
 * SDK: fee = total * rate + LAMPORTS_PER_SOL * rent_fee, recipient = total - fee.
 * So total = (amountToRecipient + rent) / (1 - rate).
 */
export function computeTotalLamportsForRecipient(
  amountToRecipientLamports: number,
  config: RelayerConfig | null
): { totalLamports: number; feeLamports: number } {
  const c = config ?? FALLBACK;
  const rentLamports = Math.floor(LAMPORTS_PER_SOL * c.withdraw_rent_fee);
  const rate = c.withdraw_fee_rate;
  if (rate >= 1) {
    return {
      totalLamports: amountToRecipientLamports + rentLamports,
      feeLamports: rentLamports,
    };
  }
  const totalLamports = Math.floor((amountToRecipientLamports + rentLamports) / (1 - rate));
  const feeLamports = totalLamports - amountToRecipientLamports;
  return { totalLamports, feeLamports: Math.max(0, feeLamports) };
}

/**
 * Compute total base_units to deduct for SPL so recipient receives amountToRecipientBaseUnits.
 * SDK: fee = base_units * rate + units_per_token * token_rent_fee, recipient = base_units - fee.
 */
export function computeTotalBaseUnitsForRecipientSPL(
  amountToRecipientBaseUnits: number,
  unitsPerToken: number,
  tokenName: string,
  config: RelayerConfig | null
): { totalBaseUnits: number; feeBaseUnits: number } {
  const c = config ?? FALLBACK;
  const tokenRentFee = c.rent_fees[tokenName] ?? 0.001;
  const rentBaseUnits = Math.floor(unitsPerToken * tokenRentFee);
  const rate = c.withdraw_fee_rate;
  if (rate >= 1) {
    return {
      totalBaseUnits: amountToRecipientBaseUnits + rentBaseUnits,
      feeBaseUnits: rentBaseUnits,
    };
  }
  const totalBaseUnits = Math.floor((amountToRecipientBaseUnits + rentBaseUnits) / (1 - rate));
  const feeBaseUnits = Math.floor(totalBaseUnits * rate + unitsPerToken * tokenRentFee);
  return { totalBaseUnits, feeBaseUnits };
}

/** Deposit has no relayer fee in the SDK (deposit.ts / depositSPL use fee = 0). */
export const DEPOSIT_FEE_LAMPORTS = 0;
export const DEPOSIT_FEE_BASE_UNITS = 0;

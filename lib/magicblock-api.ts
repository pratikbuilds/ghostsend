import { Connection, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  deriveEphemeralAta,
  deriveVault,
  deriveVaultAta,
  DELEGATION_PROGRAM_ID,
  permissionPdaFromAccount,
  verifyTeeRpcIntegrity,
  getAuthToken,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import type { PublicKey } from "@solana/web3.js";
import { MAGICBLOCK_API_ENDPOINT_URL, MAGICBLOCK_ER_ROUTER_URL } from "@/lib/network-config";

const API_BASE = "/api/magicblock";

export {
  deriveEphemeralAta,
  deriveVault,
  deriveVaultAta,
  DELEGATION_PROGRAM_ID,
  permissionPdaFromAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  verifyTeeRpcIntegrity,
  getAuthToken,
};

export interface MagicBlockConfig {
  endpoint_url: string;
  tee_endpoint_url: string;
  ephemeral_spl_token_program: string;
  delegation_program: string;
  permission_program: string;
  default_validator: string;
}

let cachedConfig: MagicBlockConfig | null = null;

export async function getConfig(): Promise<MagicBlockConfig> {
  if (cachedConfig) return cachedConfig;
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
  cachedConfig = await res.json();
  return cachedConfig!;
}

async function fetchTransaction(
  path: string,
  body: Record<string, unknown>
): Promise<VersionedTransaction> {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const txBase64 = data.transaction || data.tx;
  if (!txBase64) throw new Error("No transaction in response");
  return VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
}

export interface SendOptions {
  skipPreflight?: boolean;
  preflightCommitment?: "processed" | "confirmed" | "finalized";
}

export async function signAndSend(
  tx: VersionedTransaction,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  connection: Connection,
  sendOptions?: SendOptions
): Promise<string> {
  const signed = await signTransaction(tx);
  const opts = {
    skipPreflight: sendOptions?.skipPreflight ?? true,
    preflightCommitment: sendOptions?.preflightCommitment ?? "confirmed",
  };
  const signature = await connection.sendRawTransaction(signed.serialize(), opts);
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

export async function deposit(params: {
  user: string;
  payer: string;
  mint: string;
  amount?: number;
  validator?: string;
}): Promise<VersionedTransaction> {
  return fetchTransaction("private/tx/deposit", {
    ...params,
    amount: params.amount ?? 0,
    endpoint_url: MAGICBLOCK_API_ENDPOINT_URL,
  });
}

export async function transferAmount(params: {
  sender: string;
  recipient: string;
  mint: string;
  amount: number;
  auth_token?: string;
}): Promise<VersionedTransaction> {
  const { auth_token, ...rest } = params;
  const endpointUrl =
    auth_token != null
      ? `${MAGICBLOCK_ER_ROUTER_URL}?token=${encodeURIComponent(auth_token)}`
      : MAGICBLOCK_ER_ROUTER_URL;
  return fetchTransaction("private/tx/transfer-amount", {
    ...rest,
    endpoint_url: endpointUrl,
  });
}

/** Get TEE auth token using browser wallet signMessage. Call before transfer. */
export async function getTeeAuthToken(
  teeUrl: string,
  publicKey: PublicKey,
  signMessage: (message: Uint8Array) => Promise<Uint8Array | { signature: Uint8Array }>
): Promise<{ token: string; expiresAt: number }> {
  const isVerified = await verifyTeeRpcIntegrity(teeUrl);
  if (!isVerified) throw new Error("TEE RPC integrity verification failed");
  const sign = async (message: Uint8Array): Promise<Uint8Array> => {
    const result = await signMessage(message);
    return (result as { signature?: Uint8Array }).signature ?? (result as Uint8Array);
  };
  return getAuthToken(teeUrl, publicKey, sign);
}

export async function prepareWithdrawal(params: {
  user: string;
  mint: string;
  auth_token?: string;
}): Promise<VersionedTransaction> {
  const { auth_token: _auth_token, ...rest } = params;
  // Request tx with TEE URL only (no token). On send, client uses PER URL + token to submit the signed tx.
  return fetchTransaction("private/tx/prepare-withdrawal", {
    ...rest,
    endpoint_url: MAGICBLOCK_ER_ROUTER_URL,
  });
}

export async function withdraw(params: {
  owner: string;
  user: string;
  mint: string;
  amount: number;
}): Promise<VersionedTransaction> {
  return fetchTransaction("private/tx/withdraw", {
    ...params,
    endpoint_url: MAGICBLOCK_API_ENDPOINT_URL,
  });
}

import { Connection, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  deriveEphemeralAta,
  deriveVault,
  deriveVaultAta,
  DELEGATION_PROGRAM_ID,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
const API_BASE = "/api/magicblock";

export {
  deriveEphemeralAta,
  deriveVault,
  deriveVaultAta,
  DELEGATION_PROGRAM_ID,
  permissionPdaFromAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
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

export async function signAndSend(
  tx: VersionedTransaction,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  connection: Connection
): Promise<string> {
  const signed = await signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

export async function deposit(params: {
  user: string;
  mint: string;
  amount?: number;
  validator?: string;
}): Promise<VersionedTransaction> {
  return fetchTransaction("private/tx/deposit", {
    ...params,
    amount: params.amount ?? 0,
  });
}

export async function transferAmount(params: {
  sender: string;
  recipient: string;
  mint: string;
  amount: number;
}): Promise<VersionedTransaction> {
  return fetchTransaction("private/tx/transfer-amount", params);
}

export async function prepareWithdrawal(params: {
  user: string;
  mint: string;
}): Promise<VersionedTransaction> {
  return fetchTransaction("private/tx/prepare-withdrawal", params);
}

export async function withdraw(params: {
  owner: string;
  user: string;
  mint: string;
  amount: number;
}): Promise<VersionedTransaction> {
  return fetchTransaction("private/tx/withdraw", params);
}

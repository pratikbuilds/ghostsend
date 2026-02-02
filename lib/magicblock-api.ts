import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";

const API_BASE = "https://privacy.magicblock.app";

// ---------- Config ----------

export interface MagicBlockConfig {
  program_id: string;
  delegation_program: string;
  permission_program: string;
  magic_program: string;
}

let cachedConfig: MagicBlockConfig | null = null;

export async function getConfig(): Promise<MagicBlockConfig> {
  if (cachedConfig) return cachedConfig;
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
  const data = await res.json();
  cachedConfig = data as MagicBlockConfig;
  return cachedConfig;
}

// ---------- PDA Helpers ----------

export function deriveVaultPDA(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mint.toBuffer()],
    programId
  );
}

export function deriveEphemeralAtaPDA(
  user: PublicKey,
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ephemeral_ata"), user.toBuffer(), mint.toBuffer()],
    programId
  );
}

export function derivePermissionPDA(
  ephemeralAta: PublicKey,
  permissionProgram: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("permission"), ephemeralAta.toBuffer()],
    permissionProgram
  );
}

// ---------- Transaction Helper ----------

async function fetchTransaction(endpoint: string, body: Record<string, unknown>): Promise<VersionedTransaction> {
  const res = await fetch(`${API_BASE}/tx/${endpoint}`, {
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
  const buffer = Buffer.from(txBase64, "base64");
  return VersionedTransaction.deserialize(buffer);
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

// ---------- Infrastructure Init ----------

export async function initializeGlobalVault(payer: string, mint: string): Promise<VersionedTransaction> {
  return fetchTransaction("initialize-global-vault", { payer, mint });
}

export async function initializeGlobalVaultAta(payer: string, mint: string): Promise<VersionedTransaction> {
  return fetchTransaction("initialize-global-vault-ata", { payer, mint });
}

// ---------- User Account Init ----------

export async function initializeAta(payer: string, user: string, mint: string): Promise<VersionedTransaction> {
  return fetchTransaction("initialize-ata", { payer, user, mint });
}

export async function initializeEphemeralAta(payer: string, user: string, mint: string): Promise<VersionedTransaction> {
  return fetchTransaction("initialize-ephemeral-ata", { payer, user, mint });
}

// ---------- Permissions ----------

export async function createEphemeralAtaPermission(
  payer: string,
  user: string,
  mint: string,
  flags?: number
): Promise<VersionedTransaction> {
  return fetchTransaction("create-ephemeral-ata-permission", {
    payer,
    user,
    mint,
    ...(flags !== undefined && { flags }),
  });
}

export async function delegateEphemeralAtaPermission(
  payer: string,
  user: string,
  mint: string,
  validator?: string
): Promise<VersionedTransaction> {
  return fetchTransaction("delegate-ephemeral-ata-permission", {
    payer,
    user,
    mint,
    ...(validator && { validator }),
  });
}

export async function resetEphemeralAtaPermission(
  owner: string,
  user: string,
  mint: string,
  flags?: number
): Promise<VersionedTransaction> {
  return fetchTransaction("reset-ephemeral-ata-permission", {
    owner,
    user,
    mint,
    ...(flags !== undefined && { flags }),
  });
}

export async function undelegateEphemeralAtaPermission(
  payer: string,
  user: string,
  mint: string
): Promise<VersionedTransaction> {
  return fetchTransaction("undelegate-ephemeral-ata-permission", {
    payer,
    user,
    mint,
  });
}

// ---------- Deposit & Delegate ----------

export async function depositSplTokens(
  authority: string,
  user: string,
  mint: string,
  amount: number
): Promise<VersionedTransaction> {
  return fetchTransaction("deposit-spl-tokens", { authority, user, mint, amount });
}

export async function delegateEphemeralAta(
  payer: string,
  user: string,
  mint: string,
  ownerProgram?: string
): Promise<VersionedTransaction> {
  return fetchTransaction("delegate-ephemeral-ata", {
    payer,
    user,
    mint,
    ...(ownerProgram && { owner_program: ownerProgram }),
  });
}

// ---------- Transfer ----------

export async function transferSplTokens(
  sender: string,
  receiver: string,
  mint: string,
  amount: number
): Promise<VersionedTransaction> {
  return fetchTransaction("transfer-spl-tokens", { sender, receiver, mint, amount });
}

// ---------- Withdraw ----------

export async function undelegateEphemeralAta(
  payer: string,
  user: string,
  mint: string
): Promise<VersionedTransaction> {
  return fetchTransaction("undelegate-ephemeral-ata", { payer, user, mint });
}

export async function withdrawSplTokens(
  owner: string,
  mint: string,
  amount: number
): Promise<VersionedTransaction> {
  return fetchTransaction("withdraw-spl-tokens", { owner, mint, amount });
}

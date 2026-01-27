import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { tokens } from "privacycash/utils";
import type { SplList, TokenList } from "privacycash/utils";

// Re-export token types (from SDK constants)
export type { SplList, TokenList };
export type Token = (typeof tokens)[number];
// Re-export token list constant from SDK
export { tokens };


// Type for the wallet adapter interface
export interface WalletAdapter {
  publicKey: PublicKey;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (
    transaction: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
}

// Lazy-loaded modules (to avoid SSR issues with WASM)
let _sdkUtils: typeof import("privacycash/utils") | null = null;
let _wasmFactory: typeof import("@lightprotocol/hasher.rs") | null = null;

async function getSDKUtils() {
  if (!_sdkUtils) {
    _sdkUtils = await import("privacycash/utils");
  }
  return _sdkUtils;
}

async function getWasmFactory() {
  if (!_wasmFactory) {
    _wasmFactory = await import("@lightprotocol/hasher.rs");
  }
  return _wasmFactory;
}

// Session state management
interface PrivacyCashSession {
  publicKey: PublicKey;
  signature: Uint8Array;
  encryptionService: InstanceType<
    Awaited<ReturnType<typeof getSDKUtils>>["EncryptionService"]
  >;
  lightWasm: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof getWasmFactory>>["WasmFactory"]["getInstance"]
    >
  >;
}

let currentSession: PrivacyCashSession | null = null;

// Sign-in message constant (must match SDK)
const SIGN_MESSAGE = "Privacy Money account sign in";

/**
 * Get supported tokens list
 */
export async function getTokens(): Promise<typeof tokens> {
  const sdk = await getSDKUtils();
  return sdk.tokens;
}

/**
 * Initialize a Privacy Cash session by having the user sign a message.
 * This derives encryption keys from the signature.
 */
export async function initializeSession(
  wallet: WalletAdapter,
): Promise<PrivacyCashSession> {
  if (!wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  // Check if we already have a valid session for this wallet
  if (currentSession && currentSession.publicKey.equals(wallet.publicKey)) {
    return currentSession;
  }

  // Request signature for encryption key derivation
  const encodedMessage = new TextEncoder().encode(SIGN_MESSAGE);

  let signature: Uint8Array;
  try {
    const result = await wallet.signMessage(encodedMessage);
    // Handle wallets that return an object with signature property
    signature = (result as { signature?: Uint8Array }).signature ?? result;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message?.toLowerCase().includes("user rejected")
    ) {
      throw new Error("User rejected the signature request");
    }
    throw new Error(
      `Failed to sign message: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!(signature instanceof Uint8Array)) {
    throw new Error("Signature is not a Uint8Array");
  }

  // Load SDK modules dynamically
  const sdk = await getSDKUtils();
  const wasmModule = await getWasmFactory();

  // Initialize encryption service with signature
  const encryptionService = new sdk.EncryptionService();
  encryptionService.deriveEncryptionKeyFromSignature(signature);

  // Get LightWasm instance
  const lightWasm = await wasmModule.WasmFactory.getInstance();

  currentSession = {
    publicKey: wallet.publicKey,
    signature,
    encryptionService,
    lightWasm,
  };

  return currentSession;
}

/**
 * Sign the session message without creating a session.
 * Useful for sending the signature to a backend for server-side session init.
 */
export async function signSessionMessage(
  wallet: WalletAdapter,
): Promise<Uint8Array> {
  if (!wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  const encodedMessage = new TextEncoder().encode(SIGN_MESSAGE);

  let signature: Uint8Array;
  try {
    const result = await wallet.signMessage(encodedMessage);
    signature = (result as { signature?: Uint8Array }).signature ?? result;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message?.toLowerCase().includes("user rejected")
    ) {
      throw new Error("User rejected the signature request");
    }
    throw new Error(
      `Failed to sign message: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!(signature instanceof Uint8Array)) {
    throw new Error("Signature is not a Uint8Array");
  }

  return signature;
}

/**
 * Check if there's an active session for the given wallet
 */
export function hasActiveSession(publicKey: PublicKey): boolean {
  return currentSession !== null && currentSession.publicKey.equals(publicKey);
}

/**
 * Get the signature from the current session (for backend operations)
 * Returns null if no session exists
 */
export function getSessionSignature(publicKey: PublicKey): Uint8Array | null {
  if (currentSession && currentSession.publicKey.equals(publicKey)) {
    return currentSession.signature;
  }
  return null;
}

/**
 * Clear the current session (e.g., on wallet disconnect)
 */
export function clearSession(): void {
  currentSession = null;
}

/**
 * Get the key base path for circuit files.
 * In browser, we serve the circuit files from the public folder.
 */
function getKeyBasePath(): string {
  // The circuit files should be placed in /public/circuit2/
  // and accessed via the root path
  return "/circuit2/transaction2";
}

// Common parameters for all operations
interface OperationParams {
  connection: Connection;
  wallet: WalletAdapter;
}

/**
 * Deposit SOL into Privacy Cash
 */
export async function depositSOL(
  params: OperationParams & {
    amount_in_lamports: number;
    referrer?: string;
  },
): Promise<{ tx: string }> {
  const { connection, wallet, amount_in_lamports, referrer } = params;

  const sdk = await getSDKUtils();
  const session = await initializeSession(wallet);

  return sdk.deposit({
    lightWasm: session.lightWasm,
    connection,
    amount_in_lamports,
    keyBasePath: getKeyBasePath(),
    publicKey: session.publicKey,
    transactionSigner: async (tx: VersionedTransaction) => {
      return wallet.signTransaction(tx);
    },
    storage: localStorage,
    encryptionService: session.encryptionService,
    referrer,
  });
}

/**
 * Withdraw SOL from Privacy Cash
 */
export async function withdrawSOL(
  params: OperationParams & {
    amount_in_lamports: number;
    recipient?: string;
    referrer?: string;
  },
): Promise<{
  isPartial: boolean;
  tx: string;
  recipient: string;
  amount_in_lamports: number;
  fee_in_lamports: number;
}> {
  const { connection, wallet, amount_in_lamports, recipient, referrer } =
    params;

  const sdk = await getSDKUtils();
  const session = await initializeSession(wallet);

  const recipientPubkey = recipient
    ? new PublicKey(recipient)
    : session.publicKey;

  return sdk.withdraw({
    lightWasm: session.lightWasm,
    connection,
    amount_in_lamports,
    keyBasePath: getKeyBasePath(),
    publicKey: session.publicKey,
    recipient: recipientPubkey,
    storage: localStorage,
    encryptionService: session.encryptionService,
    referrer,
  });
}

/**
 * Deposit SPL token into Privacy Cash
 */
export async function depositSPLToken(
  params: OperationParams & {
    mintAddress: PublicKey | string;
    base_units?: number;
    amount?: number;
    referrer?: string;
  },
): Promise<{ tx: string }> {
  const { connection, wallet, mintAddress, base_units, amount, referrer } =
    params;

  const sdk = await getSDKUtils();
  const session = await initializeSession(wallet);

  return sdk.depositSPL({
    lightWasm: session.lightWasm,
    connection,
    base_units,
    amount,
    mintAddress,
    keyBasePath: getKeyBasePath(),
    publicKey: session.publicKey,
    transactionSigner: async (tx: VersionedTransaction) => {
      return wallet.signTransaction(tx);
    },
    storage: localStorage,
    encryptionService: session.encryptionService,
    referrer,
  });
}

/**
 * Withdraw SPL token from Privacy Cash
 */
export async function withdrawSPLToken(
  params: OperationParams & {
    mintAddress: PublicKey | string;
    base_units?: number;
    amount?: number;
    recipient?: string;
    referrer?: string;
  },
): Promise<{
  isPartial: boolean;
  tx: string;
  recipient: string;
  base_units: number;
  fee_base_units: number;
}> {
  const {
    connection,
    wallet,
    mintAddress,
    base_units,
    amount,
    recipient,
    referrer,
  } = params;

  const sdk = await getSDKUtils();
  const session = await initializeSession(wallet);

  const recipientPubkey = recipient
    ? new PublicKey(recipient)
    : session.publicKey;

  return sdk.withdrawSPL({
    lightWasm: session.lightWasm,
    connection,
    base_units,
    amount,
    mintAddress,
    keyBasePath: getKeyBasePath(),
    publicKey: session.publicKey,
    recipient: recipientPubkey,
    storage: localStorage,
    encryptionService: session.encryptionService,
    referrer,
  });
}

/**
 * Get private SOL balance
 */
export async function getPrivateSOLBalance(
  params: OperationParams & {
    abortSignal?: AbortSignal;
  },
): Promise<{ lamports: number }> {
  const { connection, wallet, abortSignal } = params;

  const sdk = await getSDKUtils();
  const session = await initializeSession(wallet);

  const utxos = await sdk.getUtxos({
    publicKey: session.publicKey,
    connection,
    encryptionService: session.encryptionService,
    storage: localStorage,
    abortSignal,
  });

  return sdk.getBalanceFromUtxos(utxos);
}

/**
 * Get private SPL token balance
 */
export async function getPrivateSPLBalance(
  params: OperationParams & {
    mintAddress: PublicKey | string;
    abortSignal?: AbortSignal;
  },
): Promise<{
  base_units: number;
  amount: number;
  lamports: number;
}> {
  const { connection, wallet, mintAddress, abortSignal } = params;

  const sdk = await getSDKUtils();
  const session = await initializeSession(wallet);

  const utxos = await sdk.getUtxosSPL({
    publicKey: session.publicKey,
    connection,
    encryptionService: session.encryptionService,
    storage: localStorage,
    mintAddress,
    abortSignal,
  });

  return sdk.getBalanceFromUtxosSPL(utxos);
}

/**
 * Clear local UTXO cache for the current session
 */
export function clearCache(): void {
  if (!currentSession) {
    return;
  }

  const pubkeyStr = currentSession.publicKey.toBase58();

  // Clear SOL cache
  localStorage.removeItem(`fetch_offset${pubkeyStr}`);
  localStorage.removeItem(`encrypted_outputs${pubkeyStr}`);

  // Note: SPL token caches use ATA address as key
  // Those are cleared when the full localStorage is cleared or via SDK methods
}

// Re-export setLogger for UI to capture SDK logs
export { setLogger } from "privacycash/utils";

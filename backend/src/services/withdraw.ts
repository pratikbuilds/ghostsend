import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";

export type WithdrawResult = {
  isPartial: boolean;
  tx: string;
  recipient: string;
  amount_in_lamports: number;
  fee_in_lamports: number;
};

export type WithdrawSplResult = {
  isPartial: boolean;
  tx: string;
  recipient: string;
  base_units: number;
  fee_base_units: number;
};

type Logger = {
  info: (message: string | Record<string, unknown>) => void;
  error: (message: string | Record<string, unknown>) => void;
};

const RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

export const KEY_BASE_PATH =
  process.env.KEY_BASE_PATH ||
  path.resolve(process.cwd(), "..", "public", "circuit2", "transaction2");

// ==========================================================
// GLOBAL CACHES - persist across requests for speed
// ==========================================================

let _sdk: typeof import("privacycash/utils") | null = null;
async function getSDK() {
  if (!_sdk) {
    console.log("[prover-backend] loading SDK module...");
    _sdk = await import("privacycash/utils");
    console.log("[prover-backend] SDK module loaded");
  }
  return _sdk;
}

let _lightWasm: Awaited<
  ReturnType<
    (typeof import("@lightprotocol/hasher.rs"))["WasmFactory"]["getInstance"]
  >
> | null = null;
async function getLightWasm() {
  if (!_lightWasm) {
    console.log("[prover-backend] loading LightWasm...");
    const wasmModule = await import("@lightprotocol/hasher.rs");
    _lightWasm = await wasmModule.WasmFactory.getInstance();
    console.log("[prover-backend] LightWasm loaded");
  }
  return _lightWasm;
}

let _connection: Connection | null = null;
function getConnection() {
  if (!_connection) {
    _connection = new Connection(RPC_URL, "confirmed");
    console.log("[prover-backend] connection created:", RPC_URL);
  }
  return _connection;
}

const storageCache = new Map<string, Map<string, string>>();
function getStorageForPubkey(pubkey: string): Storage {
  if (!storageCache.has(pubkey)) {
    storageCache.set(pubkey, new Map());
  }
  const map = storageCache.get(pubkey)!;
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

async function buildSessionFromSignature(
  publicKeyStr: string,
  signatureBase64: string,
) {
  const sdk = await getSDK();
  const lightWasm = await getLightWasm();

  const publicKey = new PublicKey(publicKeyStr);
  const signature = Uint8Array.from(Buffer.from(signatureBase64, "base64"));

  const encryptionService = new sdk.EncryptionService();
  encryptionService.deriveEncryptionKeyFromSignature(signature);

  return { publicKey, encryptionService, lightWasm };
}

export async function warmupWithdraw() {
  await Promise.all([getSDK(), getLightWasm()]);
}

export async function executeWithdraw(params: {
  amountLamports: number;
  recipient: string;
  publicKey: string;
  signature: string;
  log: Logger;
  logLabel?: string;
}): Promise<WithdrawResult> {
  const { amountLamports, recipient, publicKey, signature, log, logLabel } =
    params;

  const connection = getConnection();
  const { publicKey: payerKey, encryptionService, lightWasm } =
    await buildSessionFromSignature(publicKey, signature);
  const sdk = await getSDK();
  const recipientPubkey = new PublicKey(recipient);
  const storage = getStorageForPubkey(payerKey.toBase58());

  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    log.info(
      `[prover-backend][${logLabel ?? "withdraw"}] still running... ${elapsedSec}s elapsed`,
    );
  }, 15000);

  try {
    const timeoutMs = 300000; // 5 minutes
    const result = (await Promise.race([
      sdk.withdraw({
        lightWasm,
        connection,
        amount_in_lamports: amountLamports,
        keyBasePath: KEY_BASE_PATH,
        publicKey: payerKey,
        recipient: recipientPubkey,
        storage,
        encryptionService,
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Withdraw timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ])) as WithdrawResult;

    const elapsed = Date.now() - startedAt;
    log.info({
      msg: `[prover-backend][${logLabel ?? "withdraw"}] success`,
      tx: result.tx,
      amount_in_lamports: result.amount_in_lamports,
      fee_in_lamports: result.fee_in_lamports,
      isPartial: result.isPartial,
      elapsed_ms: elapsed,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({
      msg: `[prover-backend][${logLabel ?? "withdraw"}] error`,
      message,
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function executeWithdrawSpl(params: {
  amountBaseUnits: number;
  mintAddress: string;
  recipient: string;
  publicKey: string;
  signature: string;
  log: Logger;
  logLabel?: string;
}): Promise<WithdrawSplResult> {
  const {
    amountBaseUnits,
    mintAddress,
    recipient,
    publicKey,
    signature,
    log,
    logLabel,
  } = params;

  const connection = getConnection();
  const { publicKey: payerKey, encryptionService, lightWasm } =
    await buildSessionFromSignature(publicKey, signature);
  const sdk = await getSDK();
  const recipientPubkey = new PublicKey(recipient);
  const storage = getStorageForPubkey(payerKey.toBase58());

  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    log.info(
      `[prover-backend][${logLabel ?? "withdraw-spl"}] still running... ${elapsedSec}s elapsed`,
    );
  }, 15000);

  try {
    const timeoutMs = 300000; // 5 minutes
    const result = (await Promise.race([
      sdk.withdrawSPL({
        lightWasm,
        connection,
        base_units: amountBaseUnits,
        mintAddress,
        keyBasePath: KEY_BASE_PATH,
        publicKey: payerKey,
        recipient: recipientPubkey,
        storage,
        encryptionService,
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Withdraw timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ])) as WithdrawSplResult;

    const elapsed = Date.now() - startedAt;
    log.info({
      msg: `[prover-backend][${logLabel ?? "withdraw-spl"}] success`,
      tx: result.tx,
      base_units: result.base_units,
      fee_base_units: result.fee_base_units,
      isPartial: result.isPartial,
      elapsed_ms: elapsed,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({
      msg: `[prover-backend][${logLabel ?? "withdraw-spl"}] error`,
      message,
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

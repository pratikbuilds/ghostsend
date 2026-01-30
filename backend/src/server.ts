import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "fs";
import path from "path";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getConfig, tokens as sdkTokens } from "privacycash/utils";
import { paymentLinksRoutes } from "./routes/payment-links";
import { PaymentLinksStore } from "./services/payment-links/store";
import type { SDKToken } from "./types/sdk";

// SDK reads RELAYER_API_URL from NEXT_PUBLIC_RELAYER_API_URL only
if (!process.env.NEXT_PUBLIC_RELAYER_API_URL) {
  process.env.NEXT_PUBLIC_RELAYER_API_URL =
    process.env.RELAYER_API_URL || "https://api3.privacycash.org";
}

type WithdrawRequest = {
  paymentId: string;
  amountLamports: number;
  recipientAmountLamports?: number;
  publicKey: string;
  signature: string;
};

type WithdrawResult = {
  isPartial: boolean;
  amount_in_lamports: number;
  fee_in_lamports: number;
};

type WithdrawSdkResult = WithdrawResult & {
  tx: string;
  recipient?: string;
};

type WithdrawSplRequest = {
  paymentId: string;
  amountBaseUnits: number;
  recipientAmountBaseUnits?: number;
  publicKey: string;
  signature: string;
};

type WithdrawSplResult = {
  isPartial: boolean;
  base_units: number;
  fee_base_units: number;
};

type WithdrawSplSdkResult = WithdrawSplResult & {
  tx: string;
  recipient?: string;
};

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const SOL_MINT = (() => {
  const token = sdkTokens.find((sdkToken: SDKToken) => sdkToken.name === "sol");
  if (!token) return null;
  return typeof token.pubkey === "string" ? token.pubkey : token.pubkey.toBase58();
})();
type RelayerConfig = {
  withdraw_fee_rate: number;
  withdraw_rent_fee: number;
  rent_fees: Record<string, number>;
};

/** Fallback when relayer config API is unavailable; matches SDK default expectations. */
const FALLBACK_RELAYER_CONFIG: RelayerConfig = {
  withdraw_fee_rate: 0.0025,
  withdraw_rent_fee: 0.001,
  rent_fees: {},
};

let relayerConfigCache: RelayerConfig | null = null;

/**
 * Load relayer fee config from the same API the Privacy Cash SDK uses (getConfig).
 * Ensures fee calculations match the SDK. Falls back to FALLBACK_RELAYER_CONFIG on error.
 */
async function getRelayerConfig(): Promise<RelayerConfig> {
  if (relayerConfigCache) return relayerConfigCache;
  try {
    const [withdraw_fee_rate, withdraw_rent_fee, rent_fees] = await Promise.all([
      getConfig("withdraw_fee_rate"),
      getConfig("withdraw_rent_fee"),
      getConfig("rent_fees"),
    ]);
    const config: RelayerConfig = {
      withdraw_fee_rate: Number(withdraw_fee_rate),
      withdraw_rent_fee: Number(withdraw_rent_fee),
      rent_fees:
        typeof rent_fees === "object" && rent_fees !== null
          ? (rent_fees as Record<string, number>)
          : {},
    };
    relayerConfigCache = config;
    return config;
  } catch {
    relayerConfigCache = FALLBACK_RELAYER_CONFIG;
    return relayerConfigCache;
  }
}

function computeRecipientLamportsFromTotal(totalLamports: number, config: RelayerConfig): number {
  const feeLamports = Math.floor(
    totalLamports * config.withdraw_fee_rate + LAMPORTS_PER_SOL * config.withdraw_rent_fee
  );
  return totalLamports - feeLamports;
}

function computeTotalLamportsForRecipient(
  recipientLamports: number,
  config: RelayerConfig
): number {
  const rentLamports = Math.floor(LAMPORTS_PER_SOL * config.withdraw_rent_fee);
  const rate = config.withdraw_fee_rate;
  if (rate >= 1) {
    return recipientLamports + rentLamports;
  }
  return Math.floor((recipientLamports + rentLamports) / (1 - rate));
}

function computeRecipientBaseUnitsFromTotal(
  totalBaseUnits: number,
  unitsPerToken: number,
  tokenName: string,
  config: RelayerConfig
): number {
  const tokenRentFee = config.rent_fees[tokenName] ?? 0.001;
  const feeBaseUnits = Math.floor(
    totalBaseUnits * config.withdraw_fee_rate + unitsPerToken * tokenRentFee
  );
  return totalBaseUnits - feeBaseUnits;
}

function computeTotalBaseUnitsForRecipient(
  recipientBaseUnits: number,
  unitsPerToken: number,
  tokenName: string,
  config: RelayerConfig
): number {
  const tokenRentFee = config.rent_fees[tokenName] ?? 0.001;
  const rentBaseUnits = Math.floor(unitsPerToken * tokenRentFee);
  const rate = config.withdraw_fee_rate;
  if (rate >= 1) {
    return recipientBaseUnits + rentBaseUnits;
  }
  return Math.floor((recipientBaseUnits + rentBaseUnits) / (1 - rate));
}

const tokenByMint = new Map<string, SDKToken>(
  sdkTokens.map((sdkToken: SDKToken) => [
    typeof sdkToken.pubkey === "string" ? sdkToken.pubkey : sdkToken.pubkey.toBase58(),
    sdkToken,
  ])
);

// Find monorepo root public/circuit2 (shared with frontend) by walking up from cwd or __dirname
function findSharedCircuitBase(): string | null {
  const searchRoots = [
    process.cwd(),
    __dirname,
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "..", ".."),
  ];
  for (const root of searchRoots) {
    let dir = path.resolve(root);
    for (let i = 0; i < 5; i++) {
      const publicCircuit = path.join(dir, "public", "circuit2", "transaction2");
      if (fs.existsSync(publicCircuit + ".wasm") && fs.existsSync(publicCircuit + ".zkey")) {
        return publicCircuit;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const KEY_BASE_PATH = (() => {
  const shared = findSharedCircuitBase();
  if (shared) return shared;
  throw new Error(
    "Circuit files not found. Expected public/circuit2/transaction2.{wasm,zkey} in the repo root."
  );
})();
const PORT = Number(process.env.PORT || 4000);

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
  ReturnType<(typeof import("@lightprotocol/hasher.rs"))["WasmFactory"]["getInstance"]>
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

const warmupPromise = (async () => {
  console.log("[prover-backend] warming up...");
  const start = Date.now();
  await Promise.all([getSDK(), getLightWasm()]);
  console.log(`[prover-backend] warmup complete in ${Date.now() - start}ms`);
})();

async function buildSessionFromSignature(publicKeyStr: string, signatureBase64: string) {
  const sdk = await getSDK();
  const lightWasm = await getLightWasm();

  const publicKey = new PublicKey(publicKeyStr);
  const signature = Uint8Array.from(Buffer.from(signatureBase64, "base64"));

  const encryptionService = new sdk.EncryptionService();
  encryptionService.deriveEncryptionKeyFromSignature(signature);

  return { publicKey, encryptionService, lightWasm };
}

const app = Fastify({ logger: true });

app.register(cors, {
  origin: ["http://localhost:3000", "https://zoological-adaptation-production-2541.up.railway.app"],
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
});

// Register payment links routes
app.register(paymentLinksRoutes);

app.post<{ Body: WithdrawRequest }>("/withdraw", async (request, reply) => {
  await warmupPromise;

  const body = request.body;
  if (!body || !body.paymentId || !body.publicKey || !body.signature) {
    return reply.status(400).send({
      success: false,
      error: "Missing required fields",
    });
  }

  const paymentLink = PaymentLinksStore.getPaymentLink(body.paymentId);
  if (!paymentLink) {
    return reply.status(404).send({
      success: false,
      error: "Payment link not found",
    });
  }

  if (!PaymentLinksStore.canAcceptPayment(body.paymentId)) {
    return reply.status(410).send({
      success: false,
      error: "Payment link is no longer active",
    });
  }

  if (SOL_MINT && paymentLink.tokenMint !== SOL_MINT) {
    return reply.status(400).send({
      success: false,
      error: "Payment link is not SOL",
    });
  }

  const amountLamports = body.amountLamports;
  if (!amountLamports || amountLamports <= 0) {
    return reply.status(400).send({
      success: false,
      error: "Amount is required",
    });
  }

  const relayerConfig = await getRelayerConfig();
  const recipientLamports =
    body.recipientAmountLamports ??
    (paymentLink.amountType === "fixed" ? paymentLink.fixedAmount : undefined) ??
    computeRecipientLamportsFromTotal(amountLamports, relayerConfig);

  if (!recipientLamports || recipientLamports <= 0) {
    return reply.status(400).send({
      success: false,
      error: "Recipient amount is required",
    });
  }

  const validation = PaymentLinksStore.validateAmount(body.paymentId, recipientLamports);
  if (!validation.valid) {
    return reply.status(400).send({
      success: false,
      error: validation.error,
    });
  }

  const totalLamports = computeTotalLamportsForRecipient(recipientLamports, relayerConfig);
  if (Math.abs(totalLamports - amountLamports) > 2) {
    return reply.status(400).send({
      success: false,
      error: "Fee config changed; refresh and retry",
    });
  }

  const connection = getConnection();
  const { publicKey, encryptionService, lightWasm } = await buildSessionFromSignature(
    body.publicKey,
    body.signature
  );
  const sdk = await getSDK();
  const recipientPubkey = new PublicKey(paymentLink.recipientAddress);
  const storage = getStorageForPubkey(publicKey.toBase58());

  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    request.log.info(`[prover-backend][withdraw] still running... ${elapsedSec}s elapsed`);
  }, 15000);

  try {
    const timeoutMs = 300000; // 5 minutes
    const resultRaw = (await Promise.race([
      sdk.withdraw({
        lightWasm,
        connection,
        amount_in_lamports: totalLamports,
        keyBasePath: KEY_BASE_PATH,
        publicKey,
        recipient: recipientPubkey,
        storage,
        encryptionService,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Withdraw timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ])) as WithdrawSdkResult;

    const actualRecipientLamports = resultRaw.amount_in_lamports;
    const finalValidation = PaymentLinksStore.validateAmount(
      body.paymentId,
      actualRecipientLamports
    );
    if (!finalValidation.valid) {
      request.log.error({
        msg: "[prover-backend][withdraw] amount mismatch",
        error: finalValidation.error,
        paymentId: body.paymentId,
        amount_in_lamports: actualRecipientLamports,
      });
      return reply.status(400).send({
        success: false,
        error: finalValidation.error || "Withdrawal amount does not match payment link",
      });
    }

    if (!PaymentLinksStore.hasPaymentRecord(body.paymentId, resultRaw.tx)) {
      PaymentLinksStore.addPaymentRecord(
        body.paymentId,
        actualRecipientLamports,
        paymentLink.tokenMint,
        resultRaw.tx
      );
      PaymentLinksStore.incrementUsageCount(body.paymentId);
    }

    const result: WithdrawResult = {
      isPartial: resultRaw.isPartial,
      amount_in_lamports: resultRaw.amount_in_lamports,
      fee_in_lamports: resultRaw.fee_in_lamports,
    };

    const elapsed = Date.now() - startedAt;
    request.log.info({
      msg: "[prover-backend][withdraw] success",
      tx: resultRaw.tx,
      amount_in_lamports: resultRaw.amount_in_lamports,
      fee_in_lamports: resultRaw.fee_in_lamports,
      isPartial: resultRaw.isPartial,
      elapsed_ms: elapsed,
    });

    return reply.send({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    request.log.error({ msg: "[prover-backend][withdraw] error", message });
    return reply.status(500).send({
      success: false,
      error: message || "Withdraw failed",
    });
  } finally {
    clearInterval(heartbeat);
  }
});

app.post<{ Body: WithdrawSplRequest }>("/withdraw-spl", async (request, reply) => {
  await warmupPromise;

  const body = request.body;
  if (!body || !body.paymentId || !body.publicKey || !body.signature) {
    return reply.status(400).send({
      success: false,
      error: "Missing required fields",
    });
  }

  const paymentLink = PaymentLinksStore.getPaymentLink(body.paymentId);
  if (!paymentLink) {
    return reply.status(404).send({
      success: false,
      error: "Payment link not found",
    });
  }

  if (!PaymentLinksStore.canAcceptPayment(body.paymentId)) {
    return reply.status(410).send({
      success: false,
      error: "Payment link is no longer active",
    });
  }

  if (SOL_MINT && paymentLink.tokenMint === SOL_MINT) {
    return reply.status(400).send({
      success: false,
      error: "Payment link is SOL",
    });
  }

  const amountBaseUnits = body.amountBaseUnits;
  if (!amountBaseUnits || amountBaseUnits <= 0) {
    return reply.status(400).send({
      success: false,
      error: "Amount is required",
    });
  }

  const tokenInfo = tokenByMint.get(paymentLink.tokenMint);
  if (!tokenInfo) {
    return reply.status(400).send({
      success: false,
      error: "Unsupported token",
    });
  }

  const relayerConfig = await getRelayerConfig();
  const recipientBaseUnits =
    body.recipientAmountBaseUnits ??
    (paymentLink.amountType === "fixed" ? paymentLink.fixedAmount : undefined) ??
    computeRecipientBaseUnitsFromTotal(
      amountBaseUnits,
      tokenInfo.units_per_token,
      tokenInfo.name,
      relayerConfig
    );

  if (!recipientBaseUnits || recipientBaseUnits <= 0) {
    return reply.status(400).send({
      success: false,
      error: "Recipient amount is required",
    });
  }
  const validation = PaymentLinksStore.validateAmount(body.paymentId, recipientBaseUnits);
  if (!validation.valid) {
    return reply.status(400).send({
      success: false,
      error: validation.error,
    });
  }

  const totalBaseUnits = computeTotalBaseUnitsForRecipient(
    recipientBaseUnits,
    tokenInfo.units_per_token,
    tokenInfo.name,
    relayerConfig
  );
  if (Math.abs(totalBaseUnits - amountBaseUnits) > 2) {
    return reply.status(400).send({
      success: false,
      error: "Fee config changed; refresh and retry",
    });
  }

  const connection = getConnection();
  const { publicKey, encryptionService, lightWasm } = await buildSessionFromSignature(
    body.publicKey,
    body.signature
  );
  const sdk = await getSDK();
  const recipientPubkey = new PublicKey(paymentLink.recipientAddress);
  const storage = getStorageForPubkey(publicKey.toBase58());

  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    request.log.info(`[prover-backend][withdraw-spl] still running... ${elapsedSec}s elapsed`);
  }, 15000);

  try {
    const timeoutMs = 300000; // 5 minutes
    const resultRaw = (await Promise.race([
      sdk.withdrawSPL({
        lightWasm,
        connection,
        base_units: totalBaseUnits,
        mintAddress: paymentLink.tokenMint,
        keyBasePath: KEY_BASE_PATH,
        publicKey,
        recipient: recipientPubkey,
        storage,
        encryptionService,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Withdraw timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ])) as WithdrawSplSdkResult;

    const actualRecipientBaseUnits = resultRaw.base_units;
    const finalValidation = PaymentLinksStore.validateAmount(
      body.paymentId,
      actualRecipientBaseUnits
    );
    if (!finalValidation.valid) {
      request.log.error({
        msg: "[prover-backend][withdraw-spl] amount mismatch",
        error: finalValidation.error,
        paymentId: body.paymentId,
        base_units: actualRecipientBaseUnits,
      });
      return reply.status(400).send({
        success: false,
        error: finalValidation.error || "Withdrawal amount does not match payment link",
      });
    }

    if (!PaymentLinksStore.hasPaymentRecord(body.paymentId, resultRaw.tx)) {
      PaymentLinksStore.addPaymentRecord(
        body.paymentId,
        actualRecipientBaseUnits,
        paymentLink.tokenMint,
        resultRaw.tx
      );
      PaymentLinksStore.incrementUsageCount(body.paymentId);
    }

    const result: WithdrawSplResult = {
      isPartial: resultRaw.isPartial,
      base_units: resultRaw.base_units,
      fee_base_units: resultRaw.fee_base_units,
    };

    const elapsed = Date.now() - startedAt;
    request.log.info({
      msg: "[prover-backend][withdraw-spl] success",
      tx: resultRaw.tx,
      base_units: resultRaw.base_units,
      fee_base_units: resultRaw.fee_base_units,
      isPartial: resultRaw.isPartial,
      elapsed_ms: elapsed,
    });

    return reply.send({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    request.log.error({
      msg: "[prover-backend][withdraw-spl] error",
      message,
    });
    return reply.status(500).send({
      success: false,
      error: message || "Withdraw failed",
    });
  } finally {
    clearInterval(heartbeat);
  }
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`[prover-backend] listening on :${PORT}`);
    const isShared = KEY_BASE_PATH.includes("public" + path.sep + "circuit2");
    console.log(`[prover-backend] circuit path: ${KEY_BASE_PATH} (shared public: ${isShared})`);
  })
  .catch((err) => {
    console.error("[prover-backend] failed to start", err);
    process.exit(1);
  });

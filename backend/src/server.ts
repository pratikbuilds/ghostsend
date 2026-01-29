import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import { paymentLinksRoutes } from "./routes/payment-links";

type WithdrawRequest = {
  amountLamports: number;
  recipient: string;
  publicKey: string;
  signature: string;
};

type WithdrawResult = {
  isPartial: boolean;
  tx: string;
  recipient: string;
  amount_in_lamports: number;
  fee_in_lamports: number;
};

type WithdrawSplRequest = {
  amountBaseUnits: number;
  mintAddress: string;
  recipient: string;
  publicKey: string;
  signature: string;
};

type WithdrawSplResult = {
  isPartial: boolean;
  tx: string;
  recipient: string;
  base_units: number;
  fee_base_units: number;
};

const RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
// Resolve circuit files from privacycash package (works in deploy; no dependency on ../public)
const KEY_BASE_PATH =
  process.env.KEY_BASE_PATH ||
  path.resolve(
    __dirname,
    "..",
    "node_modules",
    "privacycash",
    "circuit2",
    "transaction2",
  );
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

const warmupPromise = (async () => {
  console.log("[prover-backend] warming up...");
  const start = Date.now();
  await Promise.all([getSDK(), getLightWasm()]);
  console.log(`[prover-backend] warmup complete in ${Date.now() - start}ms`);
})();

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

const app = Fastify({ logger: true });

app.register(cors, {
  origin: [
    "http://localhost:3000",
    "https://zoological-adaptation-production-2541.up.railway.app",
  ],
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
});

// Register payment links routes
app.register(paymentLinksRoutes);

app.post<{ Body: WithdrawRequest }>("/withdraw", async (request, reply) => {
  await warmupPromise;

  const body = request.body;
  if (
    !body ||
    !body.amountLamports ||
    !body.recipient ||
    !body.publicKey ||
    !body.signature
  ) {
    return reply.status(400).send({
      success: false,
      error: "Missing required fields",
    });
  }

  const connection = getConnection();
  const { publicKey, encryptionService, lightWasm } =
    await buildSessionFromSignature(body.publicKey, body.signature);
  const sdk = await getSDK();
  const recipientPubkey = new PublicKey(body.recipient);
  const storage = getStorageForPubkey(publicKey.toBase58());

  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    request.log.info(
      `[prover-backend][withdraw] still running... ${elapsedSec}s elapsed`,
    );
  }, 15000);

  try {
    const timeoutMs = 300000; // 5 minutes
    const result = (await Promise.race([
      sdk.withdraw({
        lightWasm,
        connection,
        amount_in_lamports: body.amountLamports,
        keyBasePath: KEY_BASE_PATH,
        publicKey,
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
    request.log.info({
      msg: "[prover-backend][withdraw] success",
      tx: result.tx,
      amount_in_lamports: result.amount_in_lamports,
      fee_in_lamports: result.fee_in_lamports,
      isPartial: result.isPartial,
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

app.post<{ Body: WithdrawSplRequest }>(
  "/withdraw-spl",
  async (request, reply) => {
    await warmupPromise;

    const body = request.body;
    if (
      !body ||
      !body.amountBaseUnits ||
      !body.mintAddress ||
      !body.recipient ||
      !body.publicKey ||
      !body.signature
    ) {
      return reply.status(400).send({
        success: false,
        error: "Missing required fields",
      });
    }

    const connection = getConnection();
    const { publicKey, encryptionService, lightWasm } =
      await buildSessionFromSignature(body.publicKey, body.signature);
    const sdk = await getSDK();
    const recipientPubkey = new PublicKey(body.recipient);
    const storage = getStorageForPubkey(publicKey.toBase58());

    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      request.log.info(
        `[prover-backend][withdraw-spl] still running... ${elapsedSec}s elapsed`,
      );
    }, 15000);

    try {
      const timeoutMs = 300000; // 5 minutes
      const result = (await Promise.race([
        sdk.withdrawSPL({
          lightWasm,
          connection,
          base_units: body.amountBaseUnits,
          mintAddress: body.mintAddress,
          keyBasePath: KEY_BASE_PATH,
          publicKey,
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
      request.log.info({
        msg: "[prover-backend][withdraw-spl] success",
        tx: result.tx,
        base_units: result.base_units,
        fee_base_units: result.fee_base_units,
        isPartial: result.isPartial,
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
  },
);

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`[prover-backend] listening on :${PORT}`);
    console.log(`[prover-backend] using KEY_BASE_PATH: ${KEY_BASE_PATH}`);
  })
  .catch((err) => {
    console.error("[prover-backend] failed to start", err);
    process.exit(1);
  });

import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import path from "path";

export const runtime = "nodejs";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";
const KEY_BASE_PATH = path.join(
  process.cwd(),
  "public",
  "circuit2",
  "transaction2"
);

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

// ==========================================================
// GLOBAL CACHES - persist across requests for speed
// ==========================================================

// SDK module cache
let _sdk: typeof import("privacycash/utils") | null = null;
async function getSDK() {
  if (!_sdk) {
    console.log("[privacy-cash] loading SDK module...");
    _sdk = await import("privacycash/utils");
    console.log("[privacy-cash] SDK module loaded");
  }
  return _sdk;
}

// LightWasm singleton cache
let _lightWasm: Awaited<
  ReturnType<
    typeof import("@lightprotocol/hasher.rs")["WasmFactory"]["getInstance"]
  >
> | null = null;
async function getLightWasm() {
  if (!_lightWasm) {
    console.log("[privacy-cash] loading LightWasm...");
    const wasmModule = await import("@lightprotocol/hasher.rs");
    _lightWasm = await wasmModule.WasmFactory.getInstance();
    console.log("[privacy-cash] LightWasm loaded");
  }
  return _lightWasm;
}

// Shared connection (reused across requests)
let _connection: Connection | null = null;
function getConnection() {
  if (!_connection) {
    _connection = new Connection(RPC_URL, "confirmed");
    console.log("[privacy-cash] connection created:", RPC_URL);
  }
  return _connection;
}

// In-memory storage per public key (cached across requests)
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

// ==========================================================
// WARM-UP: preload SDK and LightWasm on first import
// ==========================================================
const warmupPromise = (async () => {
  console.log("[privacy-cash] warming up backend...");
  const start = Date.now();
  await Promise.all([getSDK(), getLightWasm()]);
  console.log(`[privacy-cash] warmup complete in ${Date.now() - start}ms`);
})();

// ==========================================================
// Build session from signature (uses cached lightWasm)
// ==========================================================
async function buildSessionFromSignature(
  publicKeyStr: string,
  signatureBase64: string
) {
  const sdk = await getSDK();
  const lightWasm = await getLightWasm();

  const publicKey = new PublicKey(publicKeyStr);
  const signature = Uint8Array.from(Buffer.from(signatureBase64, "base64"));

  const encryptionService = new sdk.EncryptionService();
  encryptionService.deriveEncryptionKeyFromSignature(signature);

  return { publicKey, encryptionService, lightWasm };
}

// ==========================================================
// POST handler
// ==========================================================
export async function POST(request: NextRequest) {
  try {
    // Ensure warmup is complete
    await warmupPromise;

    console.log("[privacy-cash][withdraw] request received");
    const body = (await request.json()) as WithdrawRequest;

    if (
      !body ||
      !body.amountLamports ||
      !body.recipient ||
      !body.publicKey ||
      !body.signature
    ) {
      console.log("[privacy-cash][withdraw] missing fields", {
        amountLamports: body?.amountLamports,
        recipient: body?.recipient,
        publicKey: body?.publicKey,
        signaturePresent: Boolean(body?.signature),
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const proverUrl = process.env.PRIVACY_CASH_PROVER_URL;
    if (proverUrl) {
      console.log("[privacy-cash][withdraw] proxying to prover", {
        proverUrl,
      });
      const controller = new AbortController();
      const timeoutMs = 300000; // 5 minutes
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(proverUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const payload = await response.text();
        return new NextResponse(payload, {
          status: response.status,
          headers: {
            "content-type":
              response.headers.get("content-type") ?? "application/json",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[privacy-cash][withdraw] prover error", message);
        return NextResponse.json(
          { success: false, error: message || "Prover request failed" },
          { status: 502 }
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    console.log("[privacy-cash][withdraw] payload", {
      amountLamports: body.amountLamports,
      recipient: body.recipient,
      publicKey: body.publicKey,
      signatureLen: body.signature.length,
    });

    const connection = getConnection();
    const { publicKey, encryptionService, lightWasm } =
      await buildSessionFromSignature(body.publicKey, body.signature);

    console.log("[privacy-cash][withdraw] session initialized", {
      publicKey: publicKey.toBase58(),
    });

    const sdk = await getSDK();
    const recipientPubkey = new PublicKey(body.recipient);
    const storage = getStorageForPubkey(publicKey.toBase58());

    console.log("[privacy-cash][withdraw] calling sdk.withdraw");
    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      console.log(
        `[privacy-cash][withdraw] still running... ${elapsedSec}s elapsed`
      );
    }, 15000);

    const withdrawPromise = sdk.withdraw({
      lightWasm,
      connection,
      amount_in_lamports: body.amountLamports,
      keyBasePath: KEY_BASE_PATH,
      publicKey,
      recipient: recipientPubkey,
      storage,
      encryptionService,
    });

    const timeoutMs = 300000; // 5 minutes
    const result = (await Promise.race([
      withdrawPromise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Withdraw timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ])) as WithdrawResult;
    clearInterval(heartbeat);

    const elapsed = Date.now() - startedAt;
    console.log("[privacy-cash][withdraw] success", {
      tx: result.tx,
      amount_in_lamports: result.amount_in_lamports,
      fee_in_lamports: result.fee_in_lamports,
      isPartial: result.isPartial,
      elapsed_ms: elapsed,
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[privacy-cash][withdraw] error", message);
    return NextResponse.json(
      { success: false, error: message || "Withdraw failed" },
      { status: 500 }
    );
  }
}

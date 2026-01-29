import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  executeWithdraw,
  executeWithdrawSpl,
  KEY_BASE_PATH,
  warmupWithdraw,
} from "./services/withdraw";
import { paymentLinksRoutes } from "./routes/payment-links";

type WithdrawRequest = {
  amountLamports: number;
  recipient: string;
  publicKey: string;
  signature: string;
};


type WithdrawSplRequest = {
  amountBaseUnits: number;
  mintAddress: string;
  recipient: string;
  publicKey: string;
  signature: string;
};

const PORT = Number(process.env.PORT || 4000);

const warmupPromise = (async () => {
  console.log("[prover-backend] warming up...");
  const start = Date.now();
  await warmupWithdraw();
  console.log(`[prover-backend] warmup complete in ${Date.now() - start}ms`);
})();

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

  try {
    const result = await executeWithdraw({
      amountLamports: body.amountLamports,
      recipient: body.recipient,
      publicKey: body.publicKey,
      signature: body.signature,
      log: request.log,
      logLabel: "withdraw",
    });

    return reply.send({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.status(500).send({
      success: false,
      error: message || "Withdraw failed",
    });
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

    try {
      const result = await executeWithdrawSpl({
        amountBaseUnits: body.amountBaseUnits,
        mintAddress: body.mintAddress,
        recipient: body.recipient,
        publicKey: body.publicKey,
        signature: body.signature,
        log: request.log,
        logLabel: "withdraw-spl",
      });

      return reply.send({ success: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        success: false,
        error: message || "Withdraw failed",
      });
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

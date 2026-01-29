import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { tokens as sdkTokens } from "privacycash/utils";
import { PaymentLinksStore } from "../../services/payment-links/store";
import { executeWithdraw, executeWithdrawSpl } from "../../services/withdraw";
import {
  CreatePaymentLinkRequest,
  CreatePaymentLinkResponse,
  PaymentLinkPublicInfo,
} from "../../types/payment-links";

interface WithdrawPaymentRequest {
  amountLamports?: number;
  amountBaseUnits?: number;
  publicKey: string;
  signature: string;
}

interface PaymentLinkQuery {
  recipientAddress: string;
}

interface PaymentIdParams {
  paymentId: string;
}

const solToken = sdkTokens.find((token) => token.name === "sol");
const solMintAddress = solToken
  ? typeof solToken.pubkey === "string"
    ? solToken.pubkey
    : solToken.pubkey.toBase58()
  : "";

function isSolMint(mint: string) {
  return Boolean(solMintAddress) && mint === solMintAddress;
}

/**
 * Register payment links routes
 */
export async function paymentLinksRoutes(app: FastifyInstance) {
  // List payment links for a recipient
  app.get<{ Querystring: PaymentLinkQuery }>(
    "/payment-links",
    async (request, reply) => {
      try {
        const { recipientAddress } = request.query;

        if (!recipientAddress) {
          return reply.status(400).send({
            success: false,
            error: "Recipient address is required",
          });
        }

        const paymentLinks =
          PaymentLinksStore.listPaymentLinksByRecipient(recipientAddress);
        const publicLinks: PaymentLinkPublicInfo[] = paymentLinks.map(
          ({ recipientAddress: _recipientAddress, ...publicInfo }) =>
            publicInfo,
        );

        return reply.send({
          success: true,
          paymentLinks: publicLinks,
        });
      } catch (error) {
        request.log.error({
          msg: "Error listing payment links",
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.status(500).send({
          success: false,
          error: "Failed to list payment links",
        });
      }
    },
  );

  // List payment history for a recipient
  app.get<{ Querystring: PaymentLinkQuery }>(
    "/payment-links/history",
    async (request, reply) => {
      try {
        const { recipientAddress } = request.query;

        if (!recipientAddress) {
          return reply.status(400).send({
            success: false,
            error: "Recipient address is required",
          });
        }

        const payments =
          PaymentLinksStore.listPaymentRecordsByRecipient(recipientAddress);

        return reply.send({
          success: true,
          payments,
        });
      } catch (error) {
        request.log.error({
          msg: "Error listing payment history",
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.status(500).send({
          success: false,
          error: "Failed to list payment history",
        });
      }
    },
  );
  // Create payment link
  app.post<{ Body: CreatePaymentLinkRequest }>(
    "/payment-links",
    async (request, reply) => {
      try {
        const body = request.body;

        // Validate recipient address
        try {
          new PublicKey(body.recipientAddress);
        } catch (err) {
          return reply.status(400).send({
            success: false,
            error: "Invalid recipient address",
          });
        }

        // Validate token type
        const validMints = new Set(
          sdkTokens.map((token) =>
            typeof token.pubkey === "string"
              ? token.pubkey
              : token.pubkey.toBase58(),
          ),
        );
        if (!validMints.has(body.tokenMint)) {
          return reply.status(400).send({
            success: false,
            error: "Invalid token mint",
          });
        }

        // Validate amount type
        if (!["fixed", "flexible"].includes(body.amountType)) {
          return reply.status(400).send({
            success: false,
            error: "Invalid amount type",
          });
        }

        // Create payment link
        const paymentLink = PaymentLinksStore.createPaymentLink(body);

        // TODO: Base URL should be configurable
        const url = `${request.protocol}://${request.hostname}/pay/${paymentLink.paymentId}`;

        const { recipientAddress: _recipientAddress, ...publicInfo } =
          paymentLink;
        const response: CreatePaymentLinkResponse = {
          success: true,
          paymentLink: publicInfo,
          url,
        };

        return reply.status(201).send(response);
      } catch (error) {
        request.log.error({
          msg: "Error creating payment link",
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.status(500).send({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to create payment link",
        });
      }
    },
  );

  // Get payment link public info
  app.get<{ Params: PaymentIdParams }>(
    "/payment-links/:paymentId",
    async (request, reply) => {
      try {
        const { paymentId } = request.params;

        // Get public info (does not include recipient address)
        const paymentLink =
          PaymentLinksStore.getPaymentLinkPublicInfo(paymentId);

        if (!paymentLink) {
          return reply.status(404).send({
            success: false,
            error: "Payment link not found",
          });
        }

        return reply.send({
          success: true,
          paymentLink,
        });
      } catch (error) {
        request.log.error({
          msg: "Error fetching payment link",
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.status(500).send({
          success: false,
          error: "Failed to fetch payment link",
        });
      }
    },
  );

  // Withdraw for a payment link (backend resolves recipient)
  app.post<{ Params: PaymentIdParams; Body: WithdrawPaymentRequest }>(
    "/payment-links/:paymentId/withdraw",
    async (request, reply) => {
      try {
        const { paymentId } = request.params;
        const body = request.body;

        if (!body?.publicKey || !body?.signature) {
          return reply.status(400).send({
            success: false,
            error: "Missing required fields",
          });
        }

        const paymentLink = PaymentLinksStore.getPaymentLink(paymentId);
        if (!paymentLink) {
          return reply.status(404).send({
            success: false,
            error: "Payment link not found",
          });
        }

        if (!PaymentLinksStore.canAcceptPayment(paymentId)) {
          return reply.status(410).send({
            success: false,
            error: "Payment link is no longer active",
          });
        }

        const isSolToken = isSolMint(paymentLink.tokenMint);
        // Frontend sends total to deduct (recipient + fee), same as original /withdraw flow
        const totalToDeduct = isSolToken
          ? body.amountLamports
          : body.amountBaseUnits;

        if (
          typeof totalToDeduct !== "number" ||
          !Number.isFinite(totalToDeduct) ||
          totalToDeduct <= 0
        ) {
          return reply.status(400).send({
            success: false,
            error: "Amount is required",
          });
        }

        const recipient = paymentLink.recipientAddress;
        const result = isSolToken
          ? await executeWithdraw({
              amountLamports: totalToDeduct,
              recipient,
              publicKey: body.publicKey,
              signature: body.signature,
              log: request.log,
              logLabel: "payment-links-withdraw",
            })
          : await executeWithdrawSpl({
              amountBaseUnits: totalToDeduct,
              mintAddress: paymentLink.tokenMint,
              recipient,
              publicKey: body.publicKey,
              signature: body.signature,
              log: request.log,
              logLabel: "payment-links-withdraw-spl",
            });

        // Record recipient amount for history (fixed link = link amount; flexible = total minus fee unknown, use fixedAmount if set)
        const recordAmount =
          paymentLink.amountType === "fixed" && paymentLink.fixedAmount != null
            ? paymentLink.fixedAmount
            : totalToDeduct;
        PaymentLinksStore.addPaymentRecord(
          paymentId,
          recordAmount,
          paymentLink.tokenMint,
          result.tx,
        );
        PaymentLinksStore.incrementUsageCount(paymentId);

        return reply.send({ success: true });
      } catch (error) {
        request.log.error({
          msg: "Error withdrawing payment link",
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.status(500).send({
          success: false,
          error: "Failed to withdraw payment",
        });
      }
    },
  );

  // Delete a payment link (and its history)
  app.delete<{ Params: PaymentIdParams; Body: { recipientAddress: string } }>(
    "/payment-links/:paymentId",
    async (request, reply) => {
      try {
        const { paymentId } = request.params;
        const { recipientAddress } = request.body;

        const paymentLink = PaymentLinksStore.getPaymentLink(paymentId);

        if (!paymentLink) {
          return reply.status(404).send({
            success: false,
            error: "Payment link not found",
          });
        }

        if (paymentLink.recipientAddress !== recipientAddress) {
          return reply.status(403).send({
            success: false,
            error: "Unauthorized",
          });
        }

        PaymentLinksStore.deletePaymentLink(paymentId);

        return reply.send({ success: true });
      } catch (error) {
        request.log.error({
          msg: "Error deleting payment link",
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.status(500).send({
          success: false,
          error: "Failed to delete payment link",
        });
      }
    },
  );
}

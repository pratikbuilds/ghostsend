import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { tokens as sdkTokens } from "privacycash/utils";
import { PaymentLinksStore } from "../../services/payment-links/store";
import type { SDKToken } from "../../types/sdk";
import {
  CreatePaymentLinkRequest,
  CreatePaymentLinkResponse,
  PaymentLinkPublicInfo,
} from "../../types/payment-links";

interface GetRecipientRequest {
  amount: number;
}

interface GetRecipientParams {
  paymentId: string;
}

interface PaymentLinkQuery {
  recipientAddress: string;
}

interface CompletePaymentRequest {
  txSignature: string;
  amount: number;
}

interface PaymentIdParams {
  paymentId: string;
}

/**
 * Register payment links routes
 */
export async function paymentLinksRoutes(app: FastifyInstance) {
  // List payment links for a recipient
  app.get<{ Querystring: PaymentLinkQuery }>("/payment-links", async (request, reply) => {
    try {
      const { recipientAddress } = request.query;

      if (!recipientAddress) {
        return reply.status(400).send({
          success: false,
          error: "Recipient address is required",
        });
      }

      const paymentLinks = PaymentLinksStore.listPaymentLinksByRecipient(recipientAddress);

      return reply.send({
        success: true,
        paymentLinks,
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
  });

  // List payment history for a recipient
  app.get<{ Querystring: PaymentLinkQuery }>("/payment-links/history", async (request, reply) => {
    try {
      const { recipientAddress } = request.query;

      if (!recipientAddress) {
        return reply.status(400).send({
          success: false,
          error: "Recipient address is required",
        });
      }

      const payments = PaymentLinksStore.listPaymentRecordsByRecipient(recipientAddress);

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
  });
  // Create payment link
  app.post<{ Body: CreatePaymentLinkRequest }>("/payment-links", async (request, reply) => {
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
        sdkTokens.map((token: SDKToken) =>
          typeof token.pubkey === "string" ? token.pubkey : token.pubkey.toBase58()
        )
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

      const response: CreatePaymentLinkResponse = {
        success: true,
        paymentLink,
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
        error: error instanceof Error ? error.message : "Failed to create payment link",
      });
    }
  });

  // Get payment link public info
  app.get<{ Params: PaymentIdParams }>("/payment-links/:paymentId", async (request, reply) => {
    try {
      const { paymentId } = request.params;

      // Get public info (does not include recipient address)
      const paymentLink = PaymentLinksStore.getPaymentLinkPublicInfo(paymentId);

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
  });

  // Complete payment
  app.post<{ Params: PaymentIdParams; Body: CompletePaymentRequest }>(
    "/payment-links/:paymentId/complete",
    async (request, reply) => {
      try {
        const { paymentId } = request.params;
        const { txSignature, amount } = request.body;

        const paymentLink = PaymentLinksStore.getPaymentLink(paymentId);

        if (!paymentLink) {
          return reply.status(404).send({
            success: false,
            error: "Payment link not found",
          });
        }

        if (!txSignature) {
          return reply.status(400).send({
            success: false,
            error: "Transaction signature is required",
          });
        }

        const validation = PaymentLinksStore.validateAmount(paymentId, amount);
        if (!validation.valid) {
          return reply.status(400).send({
            success: false,
            error: validation.error,
          });
        }

        PaymentLinksStore.addPaymentRecord(paymentId, amount, paymentLink.tokenMint, txSignature);

        // Increment usage count (marks one-time links as completed)
        PaymentLinksStore.incrementUsageCount(paymentId);

        return reply.send({ success: true });
      } catch (error) {
        request.log.error({
          msg: "Error completing payment",
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.status(500).send({
          success: false,
          error: "Failed to complete payment",
        });
      }
    }
  );

  // Get recipient
  app.post<{ Body: GetRecipientRequest; Params: GetRecipientParams }>(
    "/payment-links/:paymentId/recipient",
    async (request, reply) => {
      try {
        const { paymentId } = request.params;
        const body = request.body;

        // Get payment link
        const paymentLink = PaymentLinksStore.getPaymentLink(paymentId);

        if (!paymentLink) {
          return reply.status(404).send({
            success: false,
            error: "Payment link not found",
          });
        }

        // Check if payment link can accept payments
        if (!PaymentLinksStore.canAcceptPayment(paymentId)) {
          return reply.status(410).send({
            success: false,
            error: "Payment link is no longer active",
          });
        }

        // Validate amount
        const validation = PaymentLinksStore.validateAmount(paymentId, body.amount);
        if (!validation.valid) {
          return reply.status(400).send({
            success: false,
            error: validation.error,
          });
        }

        // Return the recipient address
        return reply.send({
          success: true,
          recipientAddress: paymentLink.recipientAddress,
        });
      } catch (error) {
        request.log.error({
          msg: "Error getting recipient",
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.status(500).send({
          success: false,
          error: "Failed to get recipient",
        });
      }
    }
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
    }
  );
}

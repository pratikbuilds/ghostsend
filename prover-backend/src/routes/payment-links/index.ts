import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PublicKey } from '@solana/web3.js';
import { PaymentLinksStore } from '../../services/payment-links/store';
import { 
  CreatePaymentLinkRequest, 
  CreatePaymentLinkResponse,
  PaymentLinkPublicInfo,
} from '../../types/payment-links';

interface GetRecipientRequest {
  amount: number;
}

interface GetRecipientParams {
  paymentId: string;
}

interface PaymentIdParams {
  paymentId: string;
}

/**
 * Register payment links routes
 */
export async function paymentLinksRoutes(app: FastifyInstance) {
  // Create payment link
  app.post<{ Body: CreatePaymentLinkRequest }>(
    '/payment-links',
    async (request, reply) => {
      try {
        const body = request.body;

        // Validate recipient address
        try {
          new PublicKey(body.recipientAddress);
        } catch (err) {
          return reply.status(400).send({
            success: false,
            error: 'Invalid recipient address',
          });
        }

        // Validate token type
        const validTokens = ['sol', 'usdc', 'usdt', 'zec', 'ore', 'store'];
        if (!validTokens.includes(body.tokenType)) {
          return reply.status(400).send({
            success: false,
            error: 'Invalid token type',
          });
        }

        // Validate amount type
        if (!['fixed', 'flexible'].includes(body.amountType)) {
          return reply.status(400).send({
            success: false,
            error: 'Invalid amount type',
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
        request.log.error({ msg: 'Error creating payment link', error: error instanceof Error ? error.message : String(error) });
        return reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create payment link',
        });
      }
    }
  );

  // Get payment link public info
  app.get<{ Params: PaymentIdParams }>(
    '/payment-links/:paymentId',
    async (request, reply) => {
      try {
        const { paymentId } = request.params;

        // Get public info (does not include recipient address)
        const paymentLink = PaymentLinksStore.getPaymentLinkPublicInfo(paymentId);

        if (!paymentLink) {
          return reply.status(404).send({
            success: false,
            error: 'Payment link not found',
          });
        }

        return reply.send({
          success: true,
          paymentLink,
        });
      } catch (error) {
        request.log.error({ msg: 'Error fetching payment link', error: error instanceof Error ? error.message : String(error) });
        return reply.status(500).send({
          success: false,
          error: 'Failed to fetch payment link',
        });
      }
    }
  );

  // Complete payment
  app.post<{ Params: PaymentIdParams }>(
    '/payment-links/:paymentId/complete',
    async (request, reply) => {
      try {
        const { paymentId } = request.params;

        const paymentLink = PaymentLinksStore.getPaymentLink(paymentId);

        if (!paymentLink) {
          return reply.status(404).send({
            success: false,
            error: 'Payment link not found',
          });
        }

        // Increment usage count (marks one-time links as completed)
        PaymentLinksStore.incrementUsageCount(paymentId);

        return reply.send({ success: true });
      } catch (error) {
        request.log.error({ msg: 'Error completing payment', error: error instanceof Error ? error.message : String(error) });
        return reply.status(500).send({
          success: false,
          error: 'Failed to complete payment',
        });
      }
    }
  );

  // Get recipient
  app.post<{ Body: GetRecipientRequest; Params: GetRecipientParams }>(
    '/payment-links/:paymentId/recipient',
    async (request, reply) => {
      try {
        const { paymentId } = request.params;
        const body = request.body;

        // Get payment link
        const paymentLink = PaymentLinksStore.getPaymentLink(paymentId);

        if (!paymentLink) {
          return reply.status(404).send({
            success: false,
            error: 'Payment link not found',
          });
        }

        // Check if payment link can accept payments
        if (!PaymentLinksStore.canAcceptPayment(paymentId)) {
          return reply.status(410).send({
            success: false,
            error: 'Payment link is no longer active',
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
        request.log.error({ msg: 'Error getting recipient', error: error instanceof Error ? error.message : String(error) });
        return reply.status(500).send({
          success: false,
          error: 'Failed to get recipient',
        });
      }
    }
  );
}
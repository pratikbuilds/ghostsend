/**
 * Payment Links Storage
 *
 * In-memory storage for payment links (MVP implementation).
 * For production, replace with Redis or PostgreSQL.
 */

import { nanoid } from 'nanoid';
import type {
  PaymentLinkMetadata,
  PaymentLinkPublicInfo,
  CreatePaymentLinkRequest,
} from '../../types/payment-links';

// In-memory store
const paymentLinks = new Map<string, PaymentLinkMetadata>();

/**
 * Generate a unique payment ID
 */
function generatePaymentId(): string {
  return nanoid(12); // 12 character alphanumeric ID
}

/**
 * Convert full metadata to public info (strips recipient address)
 */
function toPublicInfo(metadata: PaymentLinkMetadata): PaymentLinkPublicInfo {
  const { recipientAddress, ...publicInfo } = metadata;
  return publicInfo;
}

/**
 * Payment Links Store Operations
 */
export const PaymentLinksStore = {
  /**
   * Create a new payment link
   */
  createPaymentLink(request: CreatePaymentLinkRequest): PaymentLinkMetadata {
    const paymentId = generatePaymentId();

    // Validate request
    if (!request.recipientAddress) {
      throw new Error('Recipient address is required');
    }

    if (request.amountType === 'fixed' && !request.fixedAmount) {
      throw new Error('Fixed amount is required for fixed amount type');
    }

    if (request.amountType === 'fixed' && request.fixedAmount! <= 0) {
      throw new Error('Fixed amount must be positive');
    }

    if (request.minAmount && request.minAmount < 0) {
      throw new Error('Min amount cannot be negative');
    }

    if (request.maxAmount && request.minAmount && request.maxAmount < request.minAmount) {
      throw new Error('Max amount must be greater than min amount');
    }

    const metadata: PaymentLinkMetadata = {
      paymentId,
      recipientAddress: request.recipientAddress,
      tokenType: request.tokenType,
      amountType: request.amountType,
      fixedAmount: request.fixedAmount,
      minAmount: request.minAmount,
      maxAmount: request.maxAmount,
      reusable: request.reusable,
      maxUsageCount: request.maxUsageCount,
      label: request.label,
      message: request.message,
      createdAt: Date.now(),
      status: 'active',
      usageCount: 0,
    };

    paymentLinks.set(paymentId, metadata);

    return metadata;
  },

  /**
   * Get payment link metadata (full, including recipient - backend only)
   */
  getPaymentLink(paymentId: string): PaymentLinkMetadata | null {
    return paymentLinks.get(paymentId) || null;
  },

  /**
   * Get public payment link info (no recipient address - safe for frontend)
   */
  getPaymentLinkPublicInfo(paymentId: string): PaymentLinkPublicInfo | null {
    const metadata = paymentLinks.get(paymentId);
    if (!metadata) return null;
    return toPublicInfo(metadata);
  },

  /**
   * Check if payment link can accept payments
   */
  canAcceptPayment(paymentId: string): boolean {
    const link = paymentLinks.get(paymentId);
    if (!link) return false;
    if (link.status !== 'active') return false;
    if (!link.reusable && link.usageCount > 0) return false;
    if (link.maxUsageCount && link.usageCount >= link.maxUsageCount) return false;
    return true;
  },

  /**
   * Validate payment amount against link requirements
   */
  validateAmount(paymentId: string, amount: number): { valid: boolean; error?: string } {
    const link = paymentLinks.get(paymentId);
    if (!link) return { valid: false, error: 'Payment link not found' };

    if (amount <= 0) {
      return { valid: false, error: 'Amount must be positive' };
    }

    if (link.amountType === 'fixed') {
      if (amount !== link.fixedAmount) {
        return { valid: false, error: `Amount must be exactly ${link.fixedAmount} lamports` };
      }
    } else {
      // Flexible amount
      if (link.minAmount && amount < link.minAmount) {
        return { valid: false, error: `Amount must be at least ${link.minAmount} lamports` };
      }
      if (link.maxAmount && amount > link.maxAmount) {
        return { valid: false, error: `Amount cannot exceed ${link.maxAmount} lamports` };
      }
    }

    return { valid: true };
  },

  /**
   * Increment usage count and update status
   */
  incrementUsageCount(paymentId: string): void {
    const link = paymentLinks.get(paymentId);
    if (!link) return;

    link.usageCount++;

    // Mark as completed if one-time link
    if (!link.reusable) {
      link.status = 'completed';
    }

    // Mark as completed if reached max usage
    if (link.maxUsageCount && link.usageCount >= link.maxUsageCount) {
      link.status = 'completed';
    }

    paymentLinks.set(paymentId, link);
  },

  /**
   * Update payment link status
   */
  updatePaymentLinkStatus(paymentId: string, status: PaymentLinkMetadata['status']): void {
    const link = paymentLinks.get(paymentId);
    if (!link) return;
    link.status = status;
    paymentLinks.set(paymentId, link);
  },

  /**
   * List all payment links for a recipient
   */
  listPaymentLinksByRecipient(recipientAddress: string): PaymentLinkMetadata[] {
    return Array.from(paymentLinks.values()).filter(
      (link) => link.recipientAddress === recipientAddress
    );
  },
};
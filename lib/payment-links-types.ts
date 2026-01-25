/**
 * Payment Links Types
 *
 * Type definitions for the private payment links feature.
 */

export type TokenType = 'sol' | 'usdc' | 'usdt' | 'zec' | 'ore' | 'store';

export type AmountType = 'fixed' | 'flexible';

export type PaymentLinkStatus = 'active' | 'completed' | 'disabled';

/**
 * Payment link metadata stored on backend
 */
export interface PaymentLinkMetadata {
  paymentId: string;
  recipientAddress: string;       // Public key of recipient (private, not exposed to sender)
  tokenType: TokenType;
  amountType: AmountType;
  fixedAmount?: number;            // In lamports for SOL, base_units for SPL tokens
  minAmount?: number;              // For flexible amounts
  maxAmount?: number;              // For flexible amounts
  reusable: boolean;
  label?: string;                  // Optional label/title
  message?: string;                // Optional message from recipient
  createdAt: number;               // Unix timestamp
  status: PaymentLinkStatus;
  usageCount: number;
  maxUsageCount?: number;          // For reusable links with usage limit
}

/**
 * Public payment link info (exposed to sender, no recipient address)
 */
export interface PaymentLinkPublicInfo {
  paymentId: string;
  tokenType: TokenType;
  amountType: AmountType;
  fixedAmount?: number;
  minAmount?: number;
  maxAmount?: number;
  label?: string;
  message?: string;
  reusable: boolean;
  status: PaymentLinkStatus;
  usageCount: number;
}

/**
 * Request to create a payment link
 */
export interface CreatePaymentLinkRequest {
  recipientAddress: string;
  tokenType: TokenType;
  amountType: AmountType;
  fixedAmount?: number;
  minAmount?: number;
  maxAmount?: number;
  reusable: boolean;
  maxUsageCount?: number;
  label?: string;
  message?: string;
}

/**
 * Response after creating a payment link
 */
export interface CreatePaymentLinkResponse {
  success: boolean;
  paymentLink: PaymentLinkMetadata;
  url: string;
}

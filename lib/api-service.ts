/**
 * Backend API Service
 *
 * Centralized service for all backend API calls.
 * This service abstracts the backend endpoint configuration and provides
 * a clean interface for components to use.
 */

import type {
  PaymentLinkPublicInfo,
  CreatePaymentLinkRequest,
  CreatePaymentLinkResponse,
  PaymentLinksListResponse,
  PaymentHistoryResponse,
  DeletePaymentLinkResponse,
} from "./payment-links-types";

// Get the backend URL from environment variable or default to localhost
const BACKEND_URL =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000"
    : process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

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

/**
 * Fetch helper with error handling
 */
async function fetchAPI<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const url = `${BACKEND_URL}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
      };
    }

    return {
      success: true,
      data: data as T,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message || "Network error",
    };
  }
}

/**
 * Payment Links API Service
 */
export const PaymentLinksAPI = {
  /**
   * Create a new payment link
   */
  async createPaymentLink(
    request: CreatePaymentLinkRequest
  ): Promise<{ success: boolean; data?: CreatePaymentLinkResponse; error?: string }> {
    return fetchAPI<CreatePaymentLinkResponse>("/payment-links", {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /**
   * Get payment link public info (no recipient address)
   */
  async getPaymentLink(paymentId: string): Promise<{
    success: boolean;
    data?: { success: boolean; paymentLink: PaymentLinkPublicInfo };
    error?: string;
  }> {
    return fetchAPI(`/payment-links/${paymentId}`, {
      method: "GET",
    });
  },

  /**
   * List payment links created by recipient
   */
  async listPaymentLinks(
    recipientAddress: string
  ): Promise<{ success: boolean; data?: PaymentLinksListResponse; error?: string }> {
    const query = encodeURIComponent(recipientAddress);
    return fetchAPI(`/payment-links?recipientAddress=${query}`, {
      method: "GET",
    });
  },

  /**
   * List payment history for recipient
   */
  async listPaymentHistory(
    recipientAddress: string
  ): Promise<{ success: boolean; data?: PaymentHistoryResponse; error?: string }> {
    const query = encodeURIComponent(recipientAddress);
    return fetchAPI(`/payment-links/history?recipientAddress=${query}`, {
      method: "GET",
    });
  },

  /**
   * Delete payment link
   */
  async deletePaymentLink(
    paymentId: string,
    recipientAddress: string
  ): Promise<{ success: boolean; data?: DeletePaymentLinkResponse; error?: string }> {
    return fetchAPI(`/payment-links/${paymentId}`, {
      method: "DELETE",
      body: JSON.stringify({ recipientAddress }),
    });
  },
};

/**
 * Privacy Cash API Service
 */
export const PrivacyCashAPI = {
  /**
   * Execute a private withdrawal
   */
  async withdraw(request: WithdrawRequest): Promise<{
    success: boolean;
    data?: { success: boolean; result: WithdrawResult };
    error?: string;
  }> {
    return fetchAPI(`/withdraw`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  /**
   * Execute a private SPL withdrawal
   */
  async withdrawSpl(request: WithdrawSplRequest): Promise<{
    success: boolean;
    data?: { success: boolean; result: WithdrawSplResult };
    error?: string;
  }> {
    return fetchAPI(`/withdraw-spl`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  },
};

"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@jup-ag/wallet-adapter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PaymentLinkCreator } from "@/components/payment-link-creator";
import { CreatedLinksTab } from "@/components/created-links-tab";
import { PaymentHistoryTab } from "@/components/payment-history-tab";
import { PaymentLinksAPI } from "@/lib/api-service";
import type {
  PaymentLinkMetadata,
  PaymentRecord,
} from "@/lib/payment-links-types";

type TabKey = "request" | "links" | "history";

export function PaymentLinksManager() {
  const { publicKey } = useWallet();
  const [activeTab, setActiveTab] = useState<TabKey>("request");
  const [createdLinks, setCreatedLinks] = useState<PaymentLinkMetadata[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const refreshLinks = useCallback(async () => {
    if (!publicKey) return;
    setLoadingLinks(true);
    setError(null);
    try {
      const result = await PaymentLinksAPI.listPaymentLinks(
        publicKey.toBase58(),
      );
      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to load payment links");
      }
      const links = [...result.data.paymentLinks].sort(
        (a, b) => b.createdAt - a.createdAt,
      );
      setCreatedLinks(links);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load links");
    } finally {
      setLoadingLinks(false);
    }
  }, [publicKey]);

  const refreshHistory = useCallback(async () => {
    if (!publicKey) return;
    setLoadingHistory(true);
    setError(null);
    try {
      const result = await PaymentLinksAPI.listPaymentHistory(
        publicKey.toBase58(),
      );
      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to load payment history");
      }
      const payments = [...result.data.payments].sort(
        (a, b) => b.completedAt - a.completedAt,
      );
      setPaymentHistory(payments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoadingHistory(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (!publicKey) return;
    if (activeTab === "links") {
      refreshLinks();
    }
    if (activeTab === "history") {
      refreshHistory();
    }
  }, [activeTab, publicKey, refreshLinks, refreshHistory]);

  const handleCreated = useCallback(
    (created: { metadata: PaymentLinkMetadata }) => {
      setCreatedLinks((prev) => [created.metadata, ...prev]);
    },
    [],
  );

  const handleDelete = useCallback(
    async (paymentId: string) => {
      if (!publicKey) return;
      setError(null);
      try {
        const result = await PaymentLinksAPI.deletePaymentLink(
          paymentId,
          publicKey.toBase58(),
        );
        if (!result.success) {
          throw new Error(result.error || "Failed to delete payment link");
        }
        setCreatedLinks((prev) =>
          prev.filter((link) => link.paymentId !== paymentId),
        );
        setPaymentHistory((prev) =>
          prev.filter((record) => record.paymentId !== paymentId),
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete payment link",
        );
      }
    },
    [publicKey],
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value: string) => setActiveTab(value as TabKey)}
      className="space-y-4"
    >
      <div className="space-y-6">
        <TabsList
          variant={"line"}
          className="grid w-full grid-cols-3 gap-0 rounded-none  bg-transparent p-0"
        >
          <TabsTrigger
            value="request"
            className="  text-base font-mono text-white data-[state=active]:border-b-cyan-500 data-[state=active]:text-white data-[state=active]:bg-transparent data-[state=active]:shadow-none "
          >
            Request Payment
          </TabsTrigger>
          <TabsTrigger
            value="links"
            className="rounded-none border-b-2 border-b-transparent px-0 py-3 text-base font-mono text-slate-400 data-[state=active]:border-b-cyan-500 data-[state=active]:text-white data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:bg-transparent/50"
          >
            Created Links
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="rounded-none border-b-2 border-b-transparent px-0 py-3 text-base font-mono text-slate-400 data-[state=active]:border-b-cyan-500 data-[state=active]:text-white data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:bg-transparent/50"
          >
            Payment History
          </TabsTrigger>
        </TabsList>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
            {error}
          </div>
        )}
      </div>

      <TabsContent value="request" className="mt-0">
        <PaymentLinkCreator onCreated={handleCreated} />
      </TabsContent>

      <TabsContent value="links" className="mt-0">
        <CreatedLinksTab
          links={createdLinks}
          loading={loadingLinks}
          onDelete={handleDelete}
          isWalletConnected={Boolean(publicKey)}
        />
      </TabsContent>

      <TabsContent value="history" className="mt-0">
        <PaymentHistoryTab
          payments={paymentHistory}
          loading={loadingHistory}
          isWalletConnected={Boolean(publicKey)}
        />
      </TabsContent>
    </Tabs>
  );
}

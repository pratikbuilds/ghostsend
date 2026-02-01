"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@jup-ag/wallet-adapter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PaymentLinkCreator } from "@/components/payment-link-creator";
import { CreatedLinksTab } from "@/components/created-links-tab";
import { PaymentHistoryTab } from "@/components/payment-history-tab";
import { PrivateTransfer } from "@/components/private-transfer";
import { cn } from "@/lib/utils";
import { PaymentLinksAPI } from "@/lib/api-service";
import type { PaymentLinkPublicInfo, PaymentRecord } from "@/lib/payment-links-types";

type TabKey = "transfer" | "request" | "links" | "history";

export function PaymentLinksManager() {
  const { publicKey } = useWallet();
  const [activeTab, setActiveTab] = useState<TabKey>("transfer");
  const [createdLinks, setCreatedLinks] = useState<PaymentLinkPublicInfo[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [lastCheckedKey, setLastCheckedKey] = useState<string | null>(null);

  const refreshLinks = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!publicKey) return;
      if (!options?.silent) {
        setLoadingLinks(true);
        setError(null);
      }
      try {
        const result = await PaymentLinksAPI.listPaymentLinks(publicKey.toBase58());
        if (!result.success || !result.data) {
          throw new Error(result.error || "Failed to load payment links");
        }
        const links = [...result.data.paymentLinks].sort((a, b) => b.createdAt - a.createdAt);
        setCreatedLinks(links);
      } catch (err) {
        if (!options?.silent) {
          setError(err instanceof Error ? err.message : "Failed to load links");
        }
      } finally {
        if (!options?.silent) {
          setLoadingLinks(false);
        }
      }
    },
    [publicKey]
  );

  const refreshHistory = useCallback(async () => {
    if (!publicKey) return;
    setLoadingHistory(true);
    setError(null);
    try {
      const result = await PaymentLinksAPI.listPaymentHistory(publicKey.toBase58());
      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to load payment history");
      }
      const payments = [...result.data.payments].sort((a, b) => b.completedAt - a.completedAt);
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

  useEffect(() => {
    const walletKey = publicKey?.toBase58();
    if (!walletKey || walletKey === lastCheckedKey) return;
    let isMounted = true;
    const probeLinks = async () => {
      await refreshLinks({ silent: true });
      if (isMounted) {
        setLastCheckedKey(walletKey);
      }
    };
    probeLinks();
    return () => {
      isMounted = false;
    };
  }, [lastCheckedKey, publicKey, refreshLinks]);

  const showDataTabs = createdLinks.length > 0 || paymentHistory.length > 0;

  useEffect(() => {
    if (!showDataTabs && (activeTab === "links" || activeTab === "history")) {
      setActiveTab("request");
    }
  }, [activeTab, showDataTabs]);

  const handleCreated = useCallback((created: { metadata: PaymentLinkPublicInfo }) => {
    setCreatedLinks((prev) => [created.metadata, ...prev]);
  }, []);

  const handleDelete = useCallback(
    async (paymentId: string) => {
      if (!publicKey) return;
      setError(null);
      try {
        const result = await PaymentLinksAPI.deletePaymentLink(paymentId, publicKey.toBase58());
        if (!result.success) {
          throw new Error(result.error || "Failed to delete payment link");
        }
        setCreatedLinks((prev) => prev.filter((link) => link.paymentId !== paymentId));
        setPaymentHistory((prev) => prev.filter((record) => record.paymentId !== paymentId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete payment link");
      }
    },
    [publicKey]
  );

  return (
    <div className="h-full min-h-0 flex flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(value: string) => setActiveTab(value as TabKey)}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="shrink-0 space-y-6">
          <TabsList variant="pill" className="mx-auto">
            <TabsTrigger value="transfer" className="text-xs font-mono uppercase">
              Transfer
            </TabsTrigger>
            <TabsTrigger value="request" className="text-xs font-mono uppercase">
              Create Link
            </TabsTrigger>
            {showDataTabs && (
              <>
                <TabsTrigger
                  value="links"
                  className="text-xs font-mono uppercase animate-in fade-in-0 slide-in-from-top-2 duration-300"
                >
                  Created
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  className="text-xs font-mono uppercase animate-in fade-in-0 slide-in-from-top-2 duration-300 delay-75"
                >
                  History
                </TabsTrigger>
              </>
            )}
          </TabsList>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
              {error}
            </div>
          )}
        </div>

        <TabsContent
          value="transfer"
          forceMount
          className={cn(
            "mt-0 flex-initial min-h-0 outline-none",
            activeTab !== "transfer" && "hidden"
          )}
        >
          <PrivateTransfer isActive={activeTab === "transfer"} />
        </TabsContent>

        <TabsContent
          value="request"
          forceMount
          className={cn(
            "mt-0 flex-initial min-h-0 outline-none",
            activeTab !== "request" && "hidden"
          )}
        >
          <PaymentLinkCreator onCreated={handleCreated} />
        </TabsContent>

        <TabsContent
          value="links"
          forceMount
          className={cn(
            "mt-0 flex-1 min-h-0 overflow-auto outline-none",
            activeTab !== "links" && "hidden"
          )}
        >
          <CreatedLinksTab
            links={createdLinks}
            loading={loadingLinks}
            onDelete={handleDelete}
            isWalletConnected={Boolean(publicKey)}
          />
        </TabsContent>

        <TabsContent
          value="history"
          forceMount
          className={cn(
            "mt-0 flex-1 min-h-0 overflow-auto outline-none",
            activeTab !== "history" && "hidden"
          )}
        >
          <PaymentHistoryTab
            payments={paymentHistory}
            loading={loadingHistory}
            isWalletConnected={Boolean(publicKey)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

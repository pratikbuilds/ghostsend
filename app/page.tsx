"use client";

import { useState } from "react";
import { Header } from "@/components/header";
import { PrivacyTest } from "@/components/privacy-test";
import { PaymentLinkCreator } from "@/components/payment-link-creator";
import { Button } from "@/components/ui/button";

export default function Page() {
  const [activeTab, setActiveTab] = useState<"test" | "links">("test");

  return (
    <div className="min-h-screen dot-pattern">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Header */}
          <div>
            <h1 className="mb-2 text-3xl font-bold tracking-tight gradient-text">
              ghostsend
            </h1>
            <p className="mb-6 text-muted-foreground">
              Private payments on Solana
            </p>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b gradient-border">
            <Button
              variant={activeTab === "test" ? "gradient" : "ghost"}
              onClick={() => setActiveTab("test")}
              className="rounded-b-none"
            >
              Privacy Test
            </Button>
            <Button
              variant={activeTab === "links" ? "gradient" : "ghost"}
              onClick={() => setActiveTab("links")}
              className="rounded-b-none"
            >
              Payment Links
            </Button>
          </div>

          {/* Tab content */}
          {activeTab === "test" && (
            <div>
              <p className="mb-6 text-sm text-muted-foreground">
                Test privacy-preserving SOL transactions on Solana mainnet.
              </p>
              <PrivacyTest />
            </div>
          )}

          {activeTab === "links" && (
            <div>
              <p className="mb-6 text-sm text-muted-foreground">
                Create private payment links. Recipients can pay you without
                revealing your wallet address publicly.
              </p>
              <PaymentLinkCreator />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

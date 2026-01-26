"use client";

import { UnifiedWalletProvider } from "@jup-ag/wallet-adapter";
import type { ReactNode } from "react";

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <UnifiedWalletProvider
      wallets={[]}
      config={{
        autoConnect: false,
        env: "mainnet-beta",
        metadata: {
          name: "GhostSend",
          description:
            "GhostSend allows you to accept payments privately and anonymously.",
          url: "https://ghostsend.xyz",
          iconUrls: ["/favicon.ico"],
        },
        theme: "dark",
        lang: "en",

        walletlistExplanation: {
          href: "https://station.jup.ag/docs/additional-topics/wallet-list",
        },
      }}
    >
      {children}
    </UnifiedWalletProvider>
  );
}

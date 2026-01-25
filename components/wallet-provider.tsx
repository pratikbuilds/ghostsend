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
          name: "Privacy UI",
          description: "Privacy-preserving Solana transactions",
          url: "https://privacy-ui.app",
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

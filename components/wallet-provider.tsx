"use client";

import { UnifiedWalletProvider } from "@jup-ag/wallet-adapter";
import type { ReactNode } from "react";
import { toast } from "sonner";

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
          iconUrls: ["/new_logo.png"],
        },
        theme: "dark",
        lang: "en",
        notificationCallback: {
          onConnecting: ({ walletName }) => {
            toast.message(`Connecting to ${walletName}`);
          },
          onConnect: ({ shortAddress }) => {
            toast.success(`Connected to ${shortAddress}`);
          },
          onDisconnect: ({ walletName }) => {
            toast.message(`Disconnected from ${walletName}`);
          },
          onNotInstalled: ({ walletName }) => {
            toast.error(`${walletName} is not installed`);
          },
        },

        walletlistExplanation: {
          href: "https://station.jup.ag/docs/additional-topics/wallet-list",
        },
      }}
    >
      {children}
    </UnifiedWalletProvider>
  );
}

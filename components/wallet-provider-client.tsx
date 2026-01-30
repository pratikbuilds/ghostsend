"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { WalletProvider } from "@/components/wallet-provider";

export function WalletProviderClient({ children }: { children: ReactNode }) {
  return (
    <>
      <WalletProvider>{children}</WalletProvider>
      <Toaster richColors position="top-right" />
    </>
  );
}

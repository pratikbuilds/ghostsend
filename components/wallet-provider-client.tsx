"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { WalletProvider } from "@/components/wallet-provider";

export function WalletProviderClient({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <>
      <WalletProvider>{children}</WalletProvider>
      <Toaster richColors position="top-right" />
    </>
  );
}

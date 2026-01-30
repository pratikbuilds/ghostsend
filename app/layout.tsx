import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { WalletProviderClient } from "@/components/wallet-provider-client";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-sans",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ghostsend | Private Payments on Solana",
  description:
    "Send and receive private payments on Solana with zero-knowledge proofs. Your transactions, your privacy.",
  metadataBase: new URL("https://ghostsend.xyz"),
  icons: {
    icon: "/new_logo.png",
    apple: "/new_logo.png",
  },
  openGraph: {
    title: "ghostsend | Private Payments on Solana",
    description:
      "Send and receive private payments on Solana with zero-knowledge proofs. Your transactions, your privacy.",
    url: "https://ghostsend.xyz",
    siteName: "ghostsend",
    images: ["/new_logo.png"],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "ghostsend | Private Payments on Solana",
    description: "Send and receive private payments on Solana with zero-knowledge proofs.",
    images: ["/new_logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} dark`}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <WalletProviderClient>{children}</WalletProviderClient>
      </body>
    </html>
  );
}

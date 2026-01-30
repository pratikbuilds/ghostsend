"use client";

import { useState, useCallback, useEffect } from "react";
import { useWallet } from "@jup-ag/wallet-adapter";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  depositSOL,
  withdrawSOL,
  getPrivateSOLBalance,
  clearSession,
  setLogger,
  type WalletAdapter,
} from "@/lib/privacy-cash";

// Mainnet RPC endpoint
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

type Status = "idle" | "loading" | "success" | "error";

interface LogEntry {
  timestamp: Date;
  message: string;
  type: "info" | "success" | "error";
}

export function PrivacyTest() {
  const wallet = useWallet();
  const [connection] = useState(() => new Connection(RPC_URL, "confirmed"));

  const [status, setStatus] = useState<Status>("idle");
  const [privateBalance, setPrivateBalance] = useState<number | null>(null);
  const [publicBalance, setPublicBalance] = useState<number | null>(null);
  const [depositAmount, setDepositAmount] = useState("0.01");
  const [withdrawAmount, setWithdrawAmount] = useState("0.01");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [verboseLogs, setVerboseLogs] = useState(false);

  const addLog = useCallback((message: string, type: "info" | "success" | "error" = "info") => {
    setLogs((prev) => [...prev, { timestamp: new Date(), message, type }]);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // Set up SDK logging, re-run when verbosity changes
  useEffect(() => {
    setLogger((level, message) => {
      // Filter: skip debug unless verbose mode
      if (level === "debug" && !verboseLogs) return;

      const type = level === "error" ? "error" : level === "warn" ? "error" : "info";
      addLog(`[SDK] ${message}`, type);
    });
  }, [verboseLogs, addLog]);

  // Fetch public balance
  const fetchPublicBalance = useCallback(async () => {
    if (!wallet.publicKey) return;
    try {
      const balance = await connection.getBalance(wallet.publicKey);
      setPublicBalance(balance);
      addLog(`Public balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    } catch (err) {
      addLog(`Failed to fetch public balance: ${err}`, "error");
    }
  }, [wallet.publicKey, connection, addLog]);

  // Fetch private balance
  const fetchPrivateBalance = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signMessage || !wallet.signTransaction) {
      addLog("Wallet not fully connected", "error");
      return;
    }

    setStatus("loading");
    addLog("Fetching private balance...");

    try {
      const walletAdapter: WalletAdapter = {
        publicKey: wallet.publicKey,
        signMessage: wallet.signMessage,
        signTransaction: wallet.signTransaction,
      };

      const result = await getPrivateSOLBalance({
        connection,
        wallet: walletAdapter,
      });

      setPrivateBalance(result.lamports);
      addLog(`Private balance: ${(result.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`, "success");
      setStatus("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Error: ${message}`, "error");
      setStatus("error");
    }
  }, [wallet, connection, addLog]);

  // Deposit SOL
  const handleDeposit = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signMessage || !wallet.signTransaction) {
      addLog("Wallet not fully connected", "error");
      return;
    }

    const lamports = Math.floor(parseFloat(depositAmount) * LAMPORTS_PER_SOL);
    if (isNaN(lamports) || lamports <= 0) {
      addLog("Invalid deposit amount", "error");
      return;
    }

    setStatus("loading");
    addLog(`Starting deposit of ${depositAmount} SOL (${lamports} lamports)...`);

    try {
      const walletAdapter: WalletAdapter = {
        publicKey: wallet.publicKey,
        signMessage: wallet.signMessage,
        signTransaction: wallet.signTransaction,
      };

      const result = await depositSOL({
        connection,
        wallet: walletAdapter,
        amount_in_lamports: lamports,
      });

      addLog(`Deposit successful! TX: ${result.tx}`, "success");
      addLog(`Explorer: https://explorer.solana.com/tx/${result.tx}`);
      setStatus("success");

      // Refresh balances
      await fetchPublicBalance();
      await fetchPrivateBalance();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Deposit failed: ${message}`, "error");
      setStatus("error");
    }
  }, [wallet, connection, depositAmount, addLog, fetchPublicBalance, fetchPrivateBalance]);

  // Withdraw SOL
  const handleWithdraw = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signMessage || !wallet.signTransaction) {
      addLog("Wallet not fully connected", "error");
      return;
    }

    const lamports = Math.floor(parseFloat(withdrawAmount) * LAMPORTS_PER_SOL);
    if (isNaN(lamports) || lamports <= 0) {
      addLog("Invalid withdraw amount", "error");
      return;
    }

    setStatus("loading");
    addLog(`Starting withdrawal of ${withdrawAmount} SOL (${lamports} lamports)...`);

    try {
      const walletAdapter: WalletAdapter = {
        publicKey: wallet.publicKey,
        signMessage: wallet.signMessage,
        signTransaction: wallet.signTransaction,
      };

      const result = await withdrawSOL({
        connection,
        wallet: walletAdapter,
        amount_in_lamports: lamports,
        recipient: recipientAddress || undefined,
      });

      addLog(`Withdrawal ${result.isPartial ? "(partial)" : ""} successful!`, "success");
      addLog(`TX: ${result.tx}`);
      addLog(`Received: ${(result.amount_in_lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      addLog(`Fee: ${(result.fee_in_lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      addLog(`Explorer: https://explorer.solana.com/tx/${result.tx}`);
      setStatus("success");

      // Refresh balances
      await fetchPublicBalance();
      await fetchPrivateBalance();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Withdrawal failed: ${message}`, "error");
      setStatus("error");
    }
  }, [
    wallet,
    connection,
    withdrawAmount,
    recipientAddress,
    addLog,
    fetchPublicBalance,
    fetchPrivateBalance,
  ]);

  // Clear session
  const handleClearSession = useCallback(() => {
    clearSession();
    setPrivateBalance(null);
    addLog("Session cleared", "info");
  }, [addLog]);

  const isLoading = status === "loading";
  const isConnected = wallet.connected && wallet.publicKey;

  return (
    <div className="space-y-6">
      {/* Wallet Status */}
      <Card>
        <CardHeader>
          <CardTitle>Wallet Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected ? (
            <>
              <p className="text-sm text-muted-foreground">
                Connected: {wallet.publicKey?.toBase58().slice(0, 8)}...
                {wallet.publicKey?.toBase58().slice(-8)}
              </p>
              <div className="flex gap-4">
                <div>
                  <p className="text-sm font-medium">Public Balance</p>
                  <p className="text-2xl font-bold">
                    {publicBalance !== null
                      ? `${(publicBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`
                      : "---"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Private Balance</p>
                  <p className="text-2xl font-bold">
                    {privateBalance !== null
                      ? `${(privateBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`
                      : "---"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={fetchPublicBalance} disabled={isLoading}>
                  Refresh Public
                </Button>
                <Button onClick={fetchPrivateBalance} disabled={isLoading}>
                  Refresh Private
                </Button>
                <Button variant="outline" onClick={handleClearSession} disabled={isLoading}>
                  Clear Session
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              Please connect your wallet using the button above
            </p>
          )}
        </CardContent>
      </Card>

      {/* Deposit */}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>Deposit SOL</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.001"
                min="0.001"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Amount in SOL"
                disabled={isLoading}
              />
              <Button onClick={handleDeposit} disabled={isLoading}>
                {isLoading ? "Processing..." : "Deposit"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Minimum: 0.001 SOL. This will send SOL to the Privacy Cash pool.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Withdraw */}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>Withdraw SOL</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.001"
                min="0.001"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="Amount in SOL"
                disabled={isLoading}
              />
              <Button onClick={handleWithdraw} disabled={isLoading}>
                {isLoading ? "Processing..." : "Withdraw"}
              </Button>
            </div>
            <Input
              type="text"
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              placeholder="Recipient address (optional, defaults to your wallet)"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Withdraw from your private balance. A relayer fee will be deducted.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Logs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Activity Log</CardTitle>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="verbose-logs" checked={verboseLogs} onCheckedChange={setVerboseLogs} />
              <Label htmlFor="verbose-logs" className="text-sm font-normal">
                Verbose
              </Label>
            </div>
            <Button variant="ghost" size="sm" onClick={clearLogs}>
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-64 overflow-y-auto rounded bg-muted/50 p-4 font-mono text-xs">
            {logs.length === 0 ? (
              <p className="text-muted-foreground">No activity yet</p>
            ) : (
              logs.map((log, i) => (
                <div
                  key={i}
                  className={`mb-1 ${
                    log.type === "error"
                      ? "text-red-500"
                      : log.type === "success"
                        ? "text-green-500"
                        : "text-foreground"
                  }`}
                >
                  <span className="text-muted-foreground">
                    [{log.timestamp.toLocaleTimeString()}]
                  </span>{" "}
                  {log.message}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

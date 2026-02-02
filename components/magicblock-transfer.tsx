"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@jup-ag/wallet-adapter";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WalletConnectButton } from "@/components/wallet-button";
import { cn } from "@/lib/utils";
import {
  getConfig,
  initializeGlobalVault,
  initializeGlobalVaultAta,
  initializeAta,
  initializeEphemeralAta,
  createEphemeralAtaPermission,
  delegateEphemeralAtaPermission,
  depositSplTokens,
  delegateEphemeralAta,
  transferSplTokens,
  undelegateEphemeralAta,
  withdrawSplTokens,
  signAndSend,
  type MagicBlockConfig,
} from "@/lib/magicblock-api";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ExternalLink,
  Settings,
  Wallet,
  Shield,
  Send,
  ArrowDownToLine,
} from "lucide-react";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

type StepStatus = "idle" | "loading" | "success" | "error";

interface StepState {
  status: StepStatus;
  signature?: string;
  error?: string;
}

const INITIAL_STEP: StepState = { status: "idle" };

const STEPS = [
  { key: "config", label: "Fetch Config", group: "Setup", icon: Settings },
  { key: "initVault", label: "Initialize Global Vault", group: "Infrastructure", icon: Shield },
  { key: "initVaultAta", label: "Initialize Global Vault ATA", group: "Infrastructure", icon: Shield },
  { key: "initSenderAta", label: "Initialize Sender ATA", group: "User Accounts", icon: Wallet },
  { key: "initReceiverAta", label: "Initialize Receiver ATA", group: "User Accounts", icon: Wallet },
  { key: "initSenderEphemeral", label: "Initialize Sender Ephemeral ATA", group: "User Accounts", icon: Wallet },
  { key: "initReceiverEphemeral", label: "Initialize Receiver Ephemeral ATA", group: "User Accounts", icon: Wallet },
  { key: "createPermission", label: "Create Ephemeral ATA Permission", group: "Permissions", icon: Shield },
  { key: "delegatePermission", label: "Delegate Ephemeral ATA Permission", group: "Permissions", icon: Shield },
  { key: "deposit", label: "Deposit SPL Tokens", group: "Deposit & Delegate", icon: ArrowDownToLine },
  { key: "delegateSender", label: "Delegate Sender Ephemeral ATA", group: "Deposit & Delegate", icon: Shield },
  { key: "delegateReceiver", label: "Delegate Receiver Ephemeral ATA", group: "Deposit & Delegate", icon: Shield },
  { key: "transfer", label: "Transfer SPL Tokens", group: "Transfer", icon: Send },
  { key: "undelegate", label: "Undelegate Ephemeral ATA", group: "Withdraw", icon: Shield },
  { key: "withdraw", label: "Withdraw SPL Tokens", group: "Withdraw", icon: ArrowDownToLine },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export function MagicBlockTransfer() {
  const { publicKey, signTransaction } = useWallet();
  const [connection] = useState(() => new Connection(RPC_URL, "confirmed"));

  const [mint, setMint] = useState("");
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [config, setConfig] = useState<MagicBlockConfig | null>(null);
  const [steps, setSteps] = useState<Record<StepKey, StepState>>(
    () => Object.fromEntries(STEPS.map((s) => [s.key, { ...INITIAL_STEP }])) as Record<StepKey, StepState>
  );
  const [expandedGroup, setExpandedGroup] = useState<string | null>("Setup");

  const updateStep = useCallback((key: StepKey, update: Partial<StepState>) => {
    setSteps((prev) => ({ ...prev, [key]: { ...prev[key], ...update } }));
  }, []);

  const execStep = useCallback(
    async (key: StepKey, fn: () => Promise<VersionedTransaction | void>) => {
      if (!signTransaction) return;
      updateStep(key, { status: "loading", error: undefined, signature: undefined });
      try {
        const result = await fn();
        if (result) {
          const sig = await signAndSend(result, signTransaction, connection);
          updateStep(key, { status: "success", signature: sig });
        } else {
          updateStep(key, { status: "success" });
        }
      } catch (err) {
        updateStep(key, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [connection, signTransaction, updateStep]
  );

  const payer = publicKey?.toBase58() ?? "";

  const handleStep = useCallback(
    async (key: StepKey) => {
      if (!publicKey || !signTransaction) return;

      switch (key) {
        case "config":
          updateStep("config", { status: "loading" });
          try {
            const cfg = await getConfig();
            setConfig(cfg);
            updateStep("config", { status: "success" });
          } catch (err) {
            updateStep("config", {
              status: "error",
              error: err instanceof Error ? err.message : String(err),
            });
          }
          return;

        case "initVault":
          return execStep(key, () => initializeGlobalVault(payer, mint));
        case "initVaultAta":
          return execStep(key, () => initializeGlobalVaultAta(payer, mint));
        case "initSenderAta":
          return execStep(key, () => initializeAta(payer, payer, mint));
        case "initReceiverAta":
          return execStep(key, () => initializeAta(payer, receiver, mint));
        case "initSenderEphemeral":
          return execStep(key, () => initializeEphemeralAta(payer, payer, mint));
        case "initReceiverEphemeral":
          return execStep(key, () => initializeEphemeralAta(payer, receiver, mint));
        case "createPermission":
          return execStep(key, () => createEphemeralAtaPermission(payer, payer, mint));
        case "delegatePermission":
          return execStep(key, () => delegateEphemeralAtaPermission(payer, payer, mint));
        case "deposit":
          return execStep(key, () => depositSplTokens(payer, payer, mint, Number(amount)));
        case "delegateSender":
          return execStep(key, () => delegateEphemeralAta(payer, payer, mint));
        case "delegateReceiver":
          return execStep(key, () => delegateEphemeralAta(payer, receiver, mint));
        case "transfer":
          return execStep(key, () => transferSplTokens(payer, receiver, mint, Number(amount)));
        case "undelegate":
          return execStep(key, () => undelegateEphemeralAta(payer, payer, mint));
        case "withdraw":
          return execStep(key, () => withdrawSplTokens(payer, mint, Number(amount)));
      }
    },
    [publicKey, signTransaction, execStep, updateStep, payer, mint, receiver, amount]
  );

  // Group steps
  const groups = STEPS.reduce<{ group: string; steps: typeof STEPS[number][] }[]>((acc, step) => {
    const last = acc[acc.length - 1];
    if (last && last.group === step.group) {
      last.steps.push(step);
    } else {
      acc.push({ group: step.group, steps: [step] });
    }
    return acc;
  }, []);

  const cardClass =
    "w-full max-w-2xl mx-auto overflow-hidden rounded-2xl border-border/50 bg-card/90 shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_oklch(0.72_0.15_220/8%)] dark:shadow-[0_0_0_1px_var(--border),0_8px_40px_-12px_black/30%]";

  return (
    <div className="space-y-4">
      <Card className={cn(cardClass, "flex max-h-[min(90vh,48rem)] flex-col")}>
        <CardHeader className="shrink-0 space-y-2 px-6 pt-6 pb-4">
          <CardTitle className="text-lg font-semibold tracking-tight sm:text-xl">
            MagicBlock Private SPL
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Private ephemeral SPL token transfers via MagicBlock.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden">
            {/* Inputs */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>Parameters</Label>
                <WalletConnectButton size="sm" />
              </div>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Token Mint Address</Label>
                  <Input
                    type="text"
                    placeholder="e.g. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
                    value={mint}
                    onChange={(e) => setMint(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Receiver Address</Label>
                  <Input
                    type="text"
                    placeholder="Receiver Solana address"
                    value={receiver}
                    onChange={(e) => setReceiver(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Amount (base units)</Label>
                  <Input
                    type="number"
                    placeholder="1000000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>

            {/* Config display */}
            {config && (
              <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2 text-xs font-mono space-y-0.5">
                <p className="text-muted-foreground">
                  <span className="text-foreground">program_id:</span> {config.program_id}
                </p>
                <p className="text-muted-foreground">
                  <span className="text-foreground">delegation:</span> {config.delegation_program}
                </p>
                <p className="text-muted-foreground">
                  <span className="text-foreground">permission:</span> {config.permission_program}
                </p>
                <p className="text-muted-foreground">
                  <span className="text-foreground">magic:</span> {config.magic_program}
                </p>
              </div>
            )}

            {/* Step groups */}
            <div className="space-y-1">
              {groups.map(({ group, steps: groupSteps }) => {
                const isExpanded = expandedGroup === group;
                const groupDone = groupSteps.every((s) => steps[s.key].status === "success");
                const groupHasError = groupSteps.some((s) => steps[s.key].status === "error");

                return (
                  <div key={group} className="rounded-lg border border-border/40 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedGroup(isExpanded ? null : group)}
                      className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted/20 transition-colors text-left"
                    >
                      <ChevronRight
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          isExpanded && "rotate-90"
                        )}
                      />
                      <span className="text-sm font-medium flex-1">{group}</span>
                      {groupDone && (
                        <CheckCircle2 className="size-4 text-green-500 shrink-0" />
                      )}
                      {groupHasError && !groupDone && (
                        <XCircle className="size-4 text-red-500 shrink-0" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border/30 px-3 py-2 space-y-2">
                        {groupSteps.map((step) => {
                          const state = steps[step.key];
                          const Icon = step.icon;
                          const isLoading = state.status === "loading";
                          const isSuccess = state.status === "success";
                          const isError = state.status === "error";

                          // Determine if step should be disabled
                          const needsWallet = !publicKey;
                          const needsMint = step.key !== "config" && !mint;
                          const needsReceiver =
                            ["initReceiverAta", "initReceiverEphemeral", "delegateReceiver", "transfer"].includes(step.key) &&
                            !receiver;
                          const needsAmount =
                            ["deposit", "transfer", "withdraw"].includes(step.key) && !amount;
                          const disabled = needsWallet || needsMint || needsReceiver || needsAmount || isLoading;

                          return (
                            <div key={step.key} className="flex items-start gap-3">
                              <div className="pt-1.5 shrink-0">
                                {isLoading ? (
                                  <Loader2 className="size-4 text-primary animate-spin" />
                                ) : isSuccess ? (
                                  <CheckCircle2 className="size-4 text-green-500" />
                                ) : isError ? (
                                  <XCircle className="size-4 text-red-500" />
                                ) : (
                                  <Icon className="size-4 text-muted-foreground" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm">{step.label}</span>
                                </div>
                                {state.signature && (
                                  <a
                                    href={`https://solscan.io/tx/${state.signature}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  >
                                    {state.signature.slice(0, 16)}…
                                    <ExternalLink className="size-3" />
                                  </a>
                                )}
                                {state.error && (
                                  <p className="text-xs text-red-500 break-all">{state.error}</p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant={isError ? "destructive" : isSuccess ? "outline" : "default"}
                                disabled={disabled}
                                onClick={() => handleStep(step.key)}
                                className="shrink-0"
                              >
                                {isLoading ? "…" : isSuccess ? "Redo" : isError ? "Retry" : "Run"}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

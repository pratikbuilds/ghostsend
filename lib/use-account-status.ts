"use client";

// useAccountStatus - commented out; did not capture intended flow for PER API
/*
import { useCallback, useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  deriveEphemeralAta,
  deriveVault,
  deriveVaultAta,
  permissionPdaFromAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  DELEGATION_PROGRAM_ID,
} from "@/lib/magicblock-api";

export interface AccountStatus {
  address: PublicKey;
  exists: boolean;
  isDelegated?: boolean; // For EATA accounts
}

export interface MagicBlockAccountState {
  vault: AccountStatus | null;
  vaultAta: AccountStatus | null;
  senderAta: AccountStatus | null;
  senderEata: AccountStatus | null;
  senderPermission: AccountStatus | null;
  receiverAta: AccountStatus | null;
  receiverEata: AccountStatus | null;
  isLoading: boolean;
}

interface UseAccountStatusParams {
  connection: Connection;
  mint: PublicKey | null;
  sender: PublicKey | null;
  receiver: PublicKey | null;
}

const INITIAL_STATE: MagicBlockAccountState = {
  vault: null,
  vaultAta: null,
  senderAta: null,
  senderEata: null,
  senderPermission: null,
  receiverAta: null,
  receiverEata: null,
  isLoading: false,
};

export function useAccountStatus({ connection, mint, sender, receiver }: UseAccountStatusParams) {
  const [accounts, setAccounts] = useState<MagicBlockAccountState>(INITIAL_STATE);

  const mintStr = mint?.toBase58() ?? null;
  const senderStr = sender?.toBase58() ?? null;
  const receiverStr = receiver?.toBase58() ?? null;

  const refresh = useCallback(async () => {
    if (!mintStr) {
      setAccounts(INITIAL_STATE);
      return;
    }

    setAccounts((prev) => ({ ...prev, isLoading: true }));

    try {
      const mintPk = new PublicKey(mintStr);
      const senderPk = senderStr ? new PublicKey(senderStr) : null;
      const receiverPk = receiverStr ? new PublicKey(receiverStr) : null;

      const [vault] = deriveVault(mintPk);
      const vaultAta = deriveVaultAta(mintPk, vault);

      const addressesToFetch: (PublicKey | null)[] = [vault, vaultAta];
      const addressKeys = ["vault", "vaultAta"];

      let senderAta: PublicKey | null = null;
      let senderEata: PublicKey | null = null;
      let senderPermission: PublicKey | null = null;

      if (senderPk) {
        senderAta = getAssociatedTokenAddressSync(mintPk, senderPk, false, TOKEN_PROGRAM_ID);
        const [eata] = deriveEphemeralAta(senderPk, mintPk);
        senderEata = eata;
        senderPermission = permissionPdaFromAccount(eata);

        addressesToFetch.push(senderAta, senderEata, senderPermission);
        addressKeys.push("senderAta", "senderEata", "senderPermission");
      }

      let receiverAta: PublicKey | null = null;
      let receiverEata: PublicKey | null = null;

      if (receiverPk) {
        receiverAta = getAssociatedTokenAddressSync(mintPk, receiverPk, false, TOKEN_PROGRAM_ID);
        const [eata] = deriveEphemeralAta(receiverPk, mintPk);
        receiverEata = eata;

        addressesToFetch.push(receiverAta, receiverEata);
        addressKeys.push("receiverAta", "receiverEata");
      }

      const validAddresses = addressesToFetch.filter((a): a is PublicKey => a !== null);
      const accountInfos = await connection.getMultipleAccountsInfo(validAddresses);

      const newState: MagicBlockAccountState = {
        vault: null,
        vaultAta: null,
        senderAta: null,
        senderEata: null,
        senderPermission: null,
        receiverAta: null,
        receiverEata: null,
        isLoading: false,
      };

      let infoIndex = 0;
      for (let i = 0; i < addressesToFetch.length; i++) {
        const addr = addressesToFetch[i];
        if (addr === null) continue;

        const info = accountInfos[infoIndex];
        const key = addressKeys[i] as keyof Omit<MagicBlockAccountState, "isLoading">;

        const isDelegated = info?.owner?.equals(DELEGATION_PROGRAM_ID) ?? false;

        newState[key] = {
          address: addr,
          exists: info !== null,
          isDelegated:
            key === "senderEata" || key === "receiverEata" || key === "senderPermission"
              ? isDelegated
              : undefined,
        };

        infoIndex++;
      }

      setAccounts(newState);
    } catch (error) {
      console.error("Failed to fetch account statuses:", error);
      setAccounts((prev) => ({ ...prev, isLoading: false }));
    }
  }, [connection, mintStr, senderStr, receiverStr]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { accounts, refresh };
}
*/

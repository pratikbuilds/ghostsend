/**
 * Declares 'privacycash/utils' so it resolves under any moduleResolution.
 * Types match privacycash dist exports; add members as server uses them.
 */
declare module "privacycash/utils" {
  import { PublicKey } from "@solana/web3.js";
  export const tokens: Array<{
    name: string;
    prefix: string;
    units_per_token: number;
    pubkey: PublicKey | string;
  }>;
  export type TokenList = string;
  export type SplList = string;
  export class EncryptionService {
    deriveEncryptionKeyFromSignature(signature: Uint8Array): void;
  }
  export function withdraw(opts: Record<string, unknown>): Promise<unknown>;
  export function withdrawSPL(opts: Record<string, unknown>): Promise<unknown>;
}

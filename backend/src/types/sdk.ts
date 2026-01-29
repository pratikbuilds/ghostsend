/**
 * Shape of token entries from privacycash/utils (tokens array).
 * Used for typing when the package does not export the Token type.
 */
export interface SDKToken {
  pubkey: { toBase58(): string } | string;
  units_per_token: number;
  name: string;
}

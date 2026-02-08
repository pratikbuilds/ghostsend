import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { RPC_URL } from "./network-config";

// Use MagicBlock RPC for token operations (same as MagicBlock transfer)
export const DEVNET_RPC_URL = RPC_URL;

// Solana devnet RPC for airdrop (MagicBlock RPC doesn't support faucet)
export const SOLANA_DEVNET_RPC_URL = "https://api.devnet.solana.com";

export interface WalletAdapter {
  publicKey: PublicKey;
  signTransaction: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
}

export interface CreateTokenResult {
  mintAddress: string;
  tokenAccount: string;
  signature: string;
  amountMinted: number;
}

/**
 * Creates a new SPL token on devnet and mints tokens to the user's wallet.
 *
 * @param connection - Solana connection (should be devnet)
 * @param wallet - Wallet adapter with publicKey and signTransaction
 * @param decimals - Number of decimals for the token (default: 9)
 * @param amountToMint - Amount of tokens to mint (in human-readable units, default: 100000)
 * @returns CreateTokenResult with mint address, token account, and signature
 */
export async function createDevnetToken(
  connection: Connection,
  wallet: WalletAdapter,
  decimals: number = 9,
  amountToMint: number = 100000
): Promise<CreateTokenResult> {
  if (!wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  // Generate a new keypair for the mint
  const mintKeypair = Keypair.generate();
  const mintPubkey = mintKeypair.publicKey;

  // Get the associated token account address for the user
  const associatedTokenAccount = await getAssociatedTokenAddress(mintPubkey, wallet.publicKey);

  // Get minimum lamports for rent exemption
  const lamportsForMint = await getMinimumBalanceForRentExemptMint(connection);

  // Calculate the amount in base units
  const amountInBaseUnits = BigInt(amountToMint) * BigInt(10 ** decimals);

  // Create instructions
  const instructions = [
    // Create account for the mint
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mintPubkey,
      space: MINT_SIZE,
      lamports: lamportsForMint,
      programId: TOKEN_PROGRAM_ID,
    }),
    // Initialize the mint
    createInitializeMintInstruction(
      mintPubkey,
      decimals,
      wallet.publicKey, // mint authority
      wallet.publicKey // freeze authority (optional)
    ),
    // Create associated token account for the user
    createAssociatedTokenAccountInstruction(
      wallet.publicKey, // payer
      associatedTokenAccount, // ata
      wallet.publicKey, // owner
      mintPubkey // mint
    ),
    // Mint tokens to the user's token account
    createMintToInstruction(
      mintPubkey, // mint
      associatedTokenAccount, // destination
      wallet.publicKey, // authority
      amountInBaseUnits // amount
    ),
  ];

  // Get latest blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  // Create a legacy transaction first (needed for partial signing with mint keypair)
  const legacyTx = new Transaction();
  legacyTx.recentBlockhash = blockhash;
  legacyTx.feePayer = wallet.publicKey;
  legacyTx.add(...instructions);

  // Partial sign with the mint keypair
  legacyTx.partialSign(mintKeypair);

  // Convert to versioned transaction for wallet signing
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(messageV0);

  // Sign with mint keypair
  versionedTx.sign([mintKeypair]);

  // Sign with wallet
  const signedTx = await wallet.signTransaction(versionedTx);

  // Send and confirm transaction
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  // Wait for confirmation
  await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  return {
    mintAddress: mintPubkey.toBase58(),
    tokenAccount: associatedTokenAccount.toBase58(),
    signature,
    amountMinted: amountToMint,
  };
}

/**
 * Request an airdrop of SOL on devnet (needed to pay for token creation)
 * Uses Solana's devnet RPC directly since MagicBlock RPC doesn't support faucet
 *
 * @param _connection - Unused, kept for backward compatibility
 * @param publicKey - Public key to receive the airdrop
 * @param amount - Amount of SOL to request (default: 1)
 * @returns Transaction signature
 */
export async function requestDevnetAirdrop(
  _connection: Connection,
  publicKey: PublicKey,
  amount: number = 1
): Promise<string> {
  // Use Solana's devnet RPC for airdrop (MagicBlock RPC doesn't support faucet)
  const solanaConnection = new Connection(SOLANA_DEVNET_RPC_URL, "confirmed");
  const lamports = amount * 1_000_000_000; // Convert SOL to lamports

  const signature = await solanaConnection.requestAirdrop(publicKey, lamports);

  // Wait for confirmation
  const { blockhash, lastValidBlockHeight } =
    await solanaConnection.getLatestBlockhash("confirmed");
  await solanaConnection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  return signature;
}

/**
 * Get the SOL balance on devnet
 *
 * @param connection - Solana connection
 * @param publicKey - Public key to check balance for
 * @returns Balance in SOL
 */
export async function getDevnetBalance(
  connection: Connection,
  publicKey: PublicKey
): Promise<number> {
  const lamports = await connection.getBalance(publicKey);
  return lamports / 1_000_000_000;
}

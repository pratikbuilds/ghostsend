<div align="center">

# Ghostsend

<img src="public/new_logo.png" alt="Ghostsend logo" width="160" />

</div>

A web application for private payments on Solana. It uses the [Privacy Cash](https://www.privacycash.org/) protocol so that senders and recipients can transact without exposing wallet addresses or amounts on-chain. The app provides a shareable payment-link flow and direct private transfers.

## Overview

- **Private transfers:** Move SOL or SPL tokens from your public balance into a private balance, then send from that private balance to one or more recipients. Recipients receive funds without your wallet address being visible on-chain.
- **Payment links:** Create a link that encodes a fixed amount and token. Anyone with the link can pay you privately; they see only the requested amount and token, not your wallet address.
- **Pay via link:** Visiting `/pay/[paymentId]` shows the payment request. The payer connects a wallet, signs once to unlock the private balance view, optionally deposits more funds, then completes the payment. Balances and flow are driven by the Privacy Cash SDK and a backend prover.

The frontend is a Next.js app; the backend is a Fastify server that stores payment links and runs the withdraw prover (zero-knowledge proof generation) for both SOL and SPL withdrawals.

## Features

### Private transfers

- **Deposit:** Send SOL or supported SPL tokens from your connected wallet into your private balance (no relayer fee on deposit).
- **Withdraw:** Send from your private balance to up to five recipients in one flow. Supports SOL and SPL (e.g. USDC, USDT, ORE, STORE, ZEC).
- **Fee handling:** Withdrawals use relayer fee configuration (rate + rent). Fee and “total to deduct” are computed in the UI using the same config source as the SDK; deposit has no fee.

### Payment links

- **Create link:** Choose token, amount, optional message, and recipient (your connected wallet or a pasted address). The backend returns a payment ID; the app shows a shareable URL (`/pay/<paymentId>`).
- **Created links:** Tab listing all payment links you created (by recipient address). Refresh and delete supported.
- **Payment history:** Tab listing completed payments for your created links (payment ID, token, amount, tx signature, date).

### Pay via link (`/pay/[paymentId]`)

- **View request:** Public info only (token, amount, optional message). Recipient address is not exposed.
- **Flow:** Connect wallet, sign the session message to reveal private balance, see public/private balances. If needed, deposit more, then pay. The app calls the backend to run the withdraw prover and records the payment for the link creator’s history.

### Supported tokens

Token list is aligned with the Privacy Cash SDK (e.g. SOL, USDC, USDT, ZEC, ORE, STORE). The UI uses a small token registry for labels, decimals, and icons. Fee config (including per-token rent) is loaded from the relayer API with a local fallback.

### Backend (Fastify)

- **Payment links:** CRUD over in-memory store (create, get by ID, list by recipient, delete, list history).
- **Withdraw prover:** `POST /withdraw` (SOL) and `POST /withdraw-spl` (SPL). Validates payment link, amount, and fee; builds session from client signature; runs SDK withdraw; returns amount and fee. Circuit files (`transaction2.wasm`, `transaction2.zkey`) are read from the repo’s `public/circuit2` directory.

## Tech stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Radix/shadcn-style UI, Jupiter wallet adapter, Solana web3.js / SPL token, Privacy Cash SDK, Light Protocol hasher (WASM).
- **Backend:** Fastify, Node, TypeScript, Privacy Cash SDK, same circuit files as frontend.
- **Tooling:** pnpm workspace, ESLint, Prettier.

## Project structure

```
ghostsend/
  app/                    # Next.js App Router
    page.tsx              # Home: PaymentLinksManager (tabs)
    pay/[paymentId]/      # Pay-via-link page
  components/             # React components (manager, creator, receiver, transfer, UI)
  lib/                    # API client, fee config, token registry, privacy-cash wrapper
  public/
    circuit2/             # WASM + zkey for proofs (copied in postinstall)
  backend/                # Fastify server (payment links + withdraw prover)
    src/
      routes/            # Payment links REST
      services/           # Payment link store
      server.ts           # App + /withdraw, /withdraw-spl
```

## Getting started

### Requirements

- Node.js >= 22
- pnpm

### Install

```bash
pnpm install
```

Postinstall copies circuit files from `node_modules` into `public/circuit2` and fixes hasher WASM paths.

### Environment

**Frontend (Next.js)**

- `NEXT_PUBLIC_SOLANA_RPC_URL` – Solana RPC URL (optional; default mainnet-beta).
- `NEXT_PUBLIC_BACKEND_URL` – Backend base URL (default `http://localhost:4000`).

**Backend**

- `PORT` – Server port (default 4000).
- `SOLANA_RPC_URL` – Solana RPC for the prover.

Copy `backend/env.example` to `backend/.env` and set `SOLANA_RPC_URL` (and optionally `PORT`).

### Run

**Development (frontend and backend):**

```bash
pnpm dev          # Next.js on http://localhost:3000
pnpm backend:dev # Fastify on http://localhost:4000
```

Use both so the app can create payment links and complete withdrawals.

**Production:**

```bash
pnpm build && pnpm start
pnpm backend:build && pnpm backend:start
```

Point the frontend’s `NEXT_PUBLIC_BACKEND_URL` at the backend you deploy.

## Scripts

| Script               | Description                     |
| -------------------- | ------------------------------- |
| `pnpm dev`           | Start Next.js dev server        |
| `pnpm build`         | Build Next.js (webpack)         |
| `pnpm start`         | Start Next.js production server |
| `pnpm backend:dev`   | Start Fastify in dev            |
| `pnpm backend:build` | Build backend                   |
| `pnpm backend:start` | Start backend production        |
| `pnpm lint`          | Lint app + backend              |
| `pnpm lint:fix`      | Lint with auto-fix              |
| `pnpm format`        | Format with Prettier            |
| `pnpm format:check`  | Check formatting                |
| `pnpm check`         | format:check + lint             |

## Backend details

The backend serves:

- **Payment links:** `POST/GET/DELETE /payment-links`, `GET /payment-links/:id`, `GET /payment-links/history?recipientAddress=...`. Data is stored in memory (see `backend/src/services/payment-links/store.ts`).
- **Withdraw:** `POST /withdraw` (SOL), `POST /withdraw-spl` (SPL). Both require a valid payment link ID, amount, and a client-signed session signature. The server runs the Privacy Cash withdraw/prover and returns the recipient amount and fee. Payment records are stored for the “payment history” tab.

For local prover setup, circuit paths, and env vars, see `backend/README.md`.

## License

See repository license.

# Privacy Cash Prover Backend

Fastify server that runs the withdraw prover and is called by the Next.js API
route via `PRIVACY_CASH_PROVER_URL`.

## Setup

1. Install dependencies:

```
npm install
```

2. Configure environment:

Copy `env.example` to `.env` and adjust paths as needed.

Required vars:

- `PORT` (default 4000)
- `SOLANA_RPC_URL`

Circuit files are loaded from the repo public directory:

- `public/circuit2/transaction2.wasm`
- `public/circuit2/transaction2.zkey`

3. Run:

```
npm run dev
```

## Test via Next.js proxy

Set `PRIVACY_CASH_PROVER_URL` in the Next app environment:

```
PRIVACY_CASH_PROVER_URL=http://localhost:4000/withdraw
```

Trigger a withdraw from the UI or via the Next API route.

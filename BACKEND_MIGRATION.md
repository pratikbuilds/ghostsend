# Backend API Migration Guide

## Overview

We have successfully migrated all API routes from NextJS to a dedicated Fastify backend server in the `prover-backend` directory. This separation allows for independent deployment and scaling of the frontend and backend services.

## Architecture

### Before Migration
```
privacy-ui (NextJS)
├── app/api/payment-links/...
├── app/api/privacy-cash/withdraw/...
└── components/
    ├── payment-link-creator.tsx (fetch /api/payment-links)
    └── payment-link-sender.tsx (fetch /api/payment-links/*, /api/privacy-cash/withdraw)
```

### After Migration
```
privacy-ui (NextJS)
├── lib/api-service.ts (centralized backend calls)
├── components/
│   ├── payment-link-creator.tsx (uses PaymentLinksAPI)
│   └── payment-link-sender.tsx (uses PaymentLinksAPI & PrivacyCashAPI)
└── .env (NEXT_PUBLIC_BACKEND_URL=http://localhost:4000)

prover-backend (Fastify)
├── src/
│   ├── server.ts (main server, handles /withdraw route)
│   ├── routes/
│   │   └── payment-links/index.ts (payment link routes)
│   ├── services/
│   │   └── payment-links/store.ts (in-memory storage)
│   └── types/
│       └── payment-links.ts (type definitions)
└── package.json
```

## Backend Endpoints

All endpoints run on the Fastify server (default: `http://localhost:4000`)

### Payment Links Routes

#### Create Payment Link
```
POST /payment-links
Content-Type: application/json

{
  "recipientAddress": "string",
  "tokenType": "sol" | "usdc" | "usdt" | "zec" | "ore" | "store",
  "amountType": "fixed" | "flexible",
  "fixedAmount"?: number (optional, for fixed amounts),
  "minAmount"?: number (optional, for flexible amounts),
  "maxAmount"?: number (optional, for flexible amounts),
  "reusable": boolean,
  "maxUsageCount"?: number (optional),
  "label"?: string (optional),
  "message"?: string (optional)
}

Response:
{
  "success": true,
  "paymentLink": { ... },
  "url": "string"
}
```

#### Get Payment Link Info
```
GET /payment-links/:paymentId

Response:
{
  "success": true,
  "paymentLink": {
    "paymentId": "string",
    "tokenType": "string",
    "amountType": "string",
    "status": "active" | "completed" | "disabled",
    ...
  }
}
```

#### Get Recipient Address
```
POST /payment-links/:paymentId/recipient
Content-Type: application/json

{
  "amount": number
}

Response:
{
  "success": true,
  "recipientAddress": "string"
}
```

#### Complete Payment
```
POST /payment-links/:paymentId/complete

Response:
{
  "success": true
}
```

### Privacy Cash Routes

#### Withdraw (Private Payment)
```
POST /withdraw
Content-Type: application/json

{
  "amountLamports": number,
  "recipient": "string" (recipient public key),
  "publicKey": "string" (sender public key),
  "signature": "string" (base64 encoded signature)
}

Response:
{
  "success": true,
  "result": {
    "isPartial": boolean,
    "tx": "string" (transaction hash),
    "recipient": "string",
    "amount_in_lamports": number,
    "fee_in_lamports": number
  }
}
```

## Running the Backend

### Development

1. Navigate to the backend directory:
   ```bash
   cd prover-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the TypeScript:
   ```bash
   npm run build
   ```

4. Start the server:
   ```bash
   npm start
   ```

The server will listen on `http://0.0.0.0:4000` by default.

### Environment Variables

- `PORT`: Server port (default: 4000)
- `SOLANA_RPC_URL`: Solana RPC endpoint (default: mainnet-beta)
- `KEY_BASE_PATH`: Path to circuit transaction keys

### Production Build

```bash
cd prover-backend
npm run build
npm start
```

## Frontend Configuration

### Environment Variables (.env)

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
NEXT_PUBLIC_PRIVACYCASH_WITHDRAW_BACKEND=true
```

## API Service Usage

The frontend uses a centralized API service (`lib/api-service.ts`) for all backend calls:

### Payment Links API

```typescript
import { PaymentLinksAPI } from '@/lib/api-service';

// Create payment link
const result = await PaymentLinksAPI.createPaymentLink({
  recipientAddress: pubkey,
  tokenType: 'sol',
  amountType: 'fixed',
  fixedAmount: 1e9, // 1 SOL in lamports
  reusable: false
});

// Get payment link info
const result = await PaymentLinksAPI.getPaymentLink(paymentId);

// Get recipient address
const result = await PaymentLinksAPI.getRecipient(paymentId, amountLamports);

// Complete payment
const result = await PaymentLinksAPI.completePayment(paymentId);
```

### Privacy Cash API

```typescript
import { PrivacyCashAPI } from '@/lib/api-service';

// Withdraw
const result = await PrivacyCashAPI.withdraw({
  amountLamports: 1e9,
  recipient: recipientAddress,
  publicKey: senderPublicKey,
  signature: signatureBase64
});
```

## Migration Details

### Changed Files

**Deleted:**
- `app/api/payment-links/route.ts`
- `app/api/payment-links/[paymentId]/route.ts`
- `app/api/payment-links/[paymentId]/recipient/route.ts`
- `app/api/payment-links/[paymentId]/complete/route.ts`
- `app/api/privacy-cash/withdraw/route.ts`

**Created:**
- `lib/api-service.ts` - Centralized API service
- `prover-backend/src/routes/payment-links/index.ts` - Payment links routes
- `prover-backend/src/services/payment-links/store.ts` - Storage layer
- `prover-backend/src/types/payment-links.ts` - Type definitions

**Updated:**
- `components/payment-link-creator.tsx` - Uses PaymentLinksAPI
- `components/payment-link-sender.tsx` - Uses PaymentLinksAPI & PrivacyCashAPI
- `prover-backend/src/server.ts` - Registers payment links routes

## Benefits

1. **Separation of Concerns**: Frontend and backend are independent
2. **Scalability**: Can scale backend independently from frontend
3. **Deployment**: Separate deployments with different pipelines
4. **Testability**: Backend can be tested independently
5. **Code Reuse**: Backend code can be used by other clients (mobile apps, etc.)
6. **Performance**: Dedicated backend server for API operations

## Future Improvements

1. **Database**: Replace in-memory storage with PostgreSQL/Redis
2. **Authentication**: Add API key or JWT authentication
3. **Rate Limiting**: Implement rate limiting for API endpoints
4. **Monitoring**: Add observability/metrics
5. **Documentation**: Add OpenAPI/Swagger documentation
6. **Caching**: Add caching strategy for frequently accessed data

## Support

For issues or questions about the migration, refer to:
- Backend implementation: `prover-backend/src/`
- Frontend service: `lib/api-service.ts`
- Component usage: `components/payment-link-creator.tsx` and `components/payment-link-sender.tsx`

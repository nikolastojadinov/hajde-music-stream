# Pi Payments API - createPayment Endpoint

## Overview

This endpoint handles Pi Network payment creation for the Hajde Music Stream application. It validates user access tokens, creates payments on Pi's testnet, and tracks payment attempts in Supabase.

## Endpoint

```
POST /payments/create
```

## Request Format

### Headers
```json
{
  "Content-Type": "application/json",
  "Origin": "https://purplemusictestnet.netlify.app"
}
```

### Body
```json
{
  "accessToken": "user_pi_access_token_from_pi_sdk",
  "amount": 1.5,
  "memo": "Premium subscription - 1 month",
  "metadata": {
    "productId": "premium_1month",
    "userId": "optional_user_id",
    "customField": "any_value"
  }
}
```

### Required Fields
- `accessToken` (string): Pi SDK access token from `authResult.accessToken`
- `amount` (number): Payment amount in Pi (must be positive)
- `memo` (string): Payment description/memo

### Optional Fields
- `metadata` (object): Additional payment metadata
  - `productId` (string): Product identifier for tracking

## Response Format

### Success Response (200 OK)
```json
{
  "success": true,
  "payment_id": "A1B2C3D4E5F6G7H8I9J0",
  "transaction_id": "tx_abc123...",
  "status": "pending",
  "amount": 1.5,
  "memo": "Premium subscription - 1 month"
}
```

### Error Responses

#### 400 Bad Request - Missing/Invalid Fields
```json
{
  "success": false,
  "error": "Missing required field: accessToken"
}
```

```json
{
  "success": false,
  "error": "Invalid amount - must be a positive number"
}
```

#### 401 Unauthorized - Invalid Access Token
```json
{
  "success": false,
  "error": "Invalid or expired Pi access token"
}
```

#### 403 Forbidden - Invalid Origin
```json
{
  "success": false,
  "error": "Forbidden - invalid origin"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Payment creation failed"
}
```

## Implementation Details

### Flow

1. **CORS Validation**: Checks if the request origin is allowed
2. **Input Validation**: Validates all required fields
3. **Token Validation**: Calls Pi API `/v2/me` to verify access token
4. **Payment Creation**: Calls Pi API `/v2/payments` with signed request
5. **Database Storage**: Saves payment record to Supabase `orders` table
6. **Response**: Returns payment details to frontend

### Pi API Integration

#### Token Validation
```
GET https://api.minepi.com/v2/me
Headers:
  Authorization: Bearer {accessToken}
  Content-Type: application/json
```

#### Payment Creation
```
POST https://api.minepi.com/v2/payments
Headers:
  Authorization: Key {PI_API_KEY}
  Content-Type: application/json
  X-Pi-Signature: {hmac_sha256_signature}

Body:
{
  "payment": {
    "amount": 1.5,
    "memo": "Premium subscription",
    "metadata": {...}
  }
}
```

### Signature Generation

The endpoint generates an HMAC-SHA256 signature for each payment request:

```typescript
function generateSignature(payload: string, secretKey: string): string {
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(payload);
  return hmac.digest('hex');
}
```

### Database Storage

Payment records are stored in the `orders` table:

```sql
{
  pi_payment_id: "A1B2C3D4E5F6G7H8I9J0",
  user_uid: "pi_user_uid",
  product_id: "premium_1month",
  txid: null,
  paid: false,
  cancelled: false,
  created_at: "2025-11-16T12:00:00Z"
}
```

## Environment Variables

Required environment variables in `.env`:

```bash
# Pi Platform API Key (from Pi Developer Portal)
PI_API_KEY=your_pi_api_key_here

# Pi Platform API URL (default: https://api.minepi.com)
PLATFORM_API_URL=https://api.minepi.com

# Frontend URL for CORS
FRONTEND_URL=https://purplemusictestnet.netlify.app

# Supabase configuration
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_key
```

## Frontend Integration Example

```typescript
import { usePi } from '@/contexts/PiContext';

function PaymentButton() {
  const { user } = usePi();
  
  const handlePayment = async () => {
    if (!user?.accessToken) {
      console.error('User not authenticated');
      return;
    }
    
    try {
      const response = await fetch('https://your-backend.com/payments/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accessToken: user.accessToken,
          amount: 1.5,
          memo: 'Premium Subscription',
          metadata: {
            productId: 'premium_1month',
          },
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('Payment created:', result.payment_id);
      } else {
        console.error('Payment failed:', result.error);
      }
    } catch (error) {
      console.error('Payment request failed:', error);
    }
  };
  
  return <button onClick={handlePayment}>Pay with Pi</button>;
}
```

## Security Features

1. **CORS Protection**: Only allows requests from whitelisted origins
2. **Token Validation**: Verifies Pi access token with Pi API before creating payment
3. **Request Signing**: Signs all payment requests with HMAC-SHA256
4. **Input Validation**: Validates all required fields and types
5. **Error Handling**: Safe error handling without exposing sensitive data

## Testing

### Test with cURL

```bash
curl -X POST https://your-backend.com/payments/create \
  -H "Content-Type: application/json" \
  -H "Origin: https://purplemusictestnet.netlify.app" \
  -d '{
    "accessToken": "pi_access_token_here",
    "amount": 0.1,
    "memo": "Test payment",
    "metadata": {
      "productId": "test_product"
    }
  }'
```

### Expected Test Flow

1. User authenticates via Pi Browser SDK
2. Frontend receives `accessToken` from Pi SDK
3. Frontend calls `/payments/create` with `accessToken`
4. Backend validates token and creates payment
5. Pi SDK shows payment approval dialog to user
6. User approves payment in Pi Browser
7. Backend receives webhook/callback for approval
8. Payment is completed on Pi blockchain

## Troubleshooting

### Common Issues

1. **"Invalid or expired Pi access token"**
   - Ensure the access token is fresh from Pi SDK authentication
   - Check that the user is authenticated in Pi Browser

2. **"Forbidden - invalid origin"**
   - Verify the request origin matches allowed origins
   - Check CORS configuration in backend

3. **"Pi API returned 401"**
   - Verify PI_API_KEY is correct in `.env`
   - Check API key permissions in Pi Developer Portal

4. **"Payment creation failed"**
   - Check backend logs for detailed error messages
   - Verify Pi Platform API is accessible
   - Ensure testnet is available

## Related Endpoints

- `/payments/approve` - Approve a pending payment
- `/payments/complete` - Mark payment as completed
- `/payments/cancelled_payment` - Handle cancelled payments
- `/payments/incomplete` - Handle incomplete payments

## Notes

- This endpoint uses **Pi Testnet** for testing
- Payments are created with status `pending`
- Actual blockchain transaction occurs after user approval
- Database records are created immediately for tracking

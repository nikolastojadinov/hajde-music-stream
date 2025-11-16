/**
 * Pi Network Payment Creation Endpoint (TESTNET)
 * 
 * This endpoint creates a new payment using the Pi Platform API.
 * It validates the user's access token, creates the payment on Pi's testnet,
 * and stores the payment attempt in Supabase.
 * 
 * Flow:
 * 1. Validate request body (amount, memo, metadata)
 * 2. Validate Pi access token by calling Pi API /v2/me
 * 3. Create payment via Pi API /v2/payments
 * 4. Store payment record in Supabase
 * 5. Return payment details to frontend
 */

import crypto from 'crypto';
import fetch from 'node-fetch';
import type { Request, Response } from 'express';
import supabase from '../../services/supabaseClient';
import env from '../../environments';

interface PiUser {
  uid: string;
  username: string;
}

interface PaymentMetadata {
  productId?: string;
  [key: string]: any;
}

interface CreatePaymentRequest {
  accessToken: string;
  amount: number;
  memo: string;
  metadata?: PaymentMetadata;
}

interface PiPaymentResult {
  identifier: string;
  status: string;
  transaction?: {
    txid: string;
  };
}

/**
 * Generate HMAC-SHA256 signature for Pi API requests
 * @param payload - The request payload as JSON string
 * @param secretKey - PI_API_KEY from environment
 * @returns Hex-encoded signature
 */
function generateSignature(payload: string, secretKey: string): string {
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(payload);
  return hmac.digest('hex');
}

/**
 * Validate Pi access token by fetching user info from Pi API
 * @param accessToken - User's Pi access token
 * @returns User info or null if invalid
 */
async function validatePiAccessToken(accessToken: string): Promise<PiUser | null> {
  try {
    const response = await fetch(`${env.platform_api_url}/v2/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[createPayment] Failed to validate access token:', response.status, response.statusText);
      return null;
    }

    const userData = await response.json() as PiUser;
    return {
      uid: userData.uid,
      username: userData.username,
    };
  } catch (error) {
    console.error('[createPayment] Error validating access token:', error);
    return null;
  }
}

/**
 * Create a payment on Pi Network (Testnet)
 * @param paymentData - Payment details
 * @returns Payment creation response
 */
async function createPiPayment({ amount, memo, metadata }: { 
  amount: number; 
  memo: string; 
  metadata?: PaymentMetadata 
}): Promise<PiPaymentResult> {
  const paymentPayload = {
    payment: {
      amount,
      memo,
      metadata: metadata || {},
    },
  };

  const payloadString = JSON.stringify(paymentPayload);
  const signature = generateSignature(payloadString, env.pi_api_key);

  try {
    const response = await fetch(`${env.platform_api_url}/v2/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${env.pi_api_key}`,
        'Content-Type': 'application/json',
        'X-Pi-Signature': signature,
      },
      body: payloadString,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[createPayment] Pi API error:', response.status, errorText);
      throw new Error(`Pi API returned ${response.status}: ${errorText}`);
    }

    const result = await response.json() as PiPaymentResult;
    return result;
  } catch (error) {
    console.error('[createPayment] Error creating payment on Pi:', error);
    throw error;
  }
}

/**
 * Main handler for POST /payments/create
 * Creates a new Pi payment after validating the user and request
 */
export default async function createPaymentHandler(req: Request, res: Response): Promise<Response> {
  // CORS check - only allow requests from frontend
  const origin = req.headers.origin;
  const allowedOrigins = [
    env.frontend_url,
    'https://purplemusictestnet.netlify.app',
    'http://localhost:5173',
  ];

  if (!origin || !allowedOrigins.includes(origin)) {
    console.warn('[createPayment] Blocked request from unauthorized origin:', origin);
    return res.status(403).json({
      success: false,
      error: 'Forbidden - invalid origin',
    });
  }

  // Validate request body
  const { accessToken, amount, memo, metadata } = req.body as CreatePaymentRequest;

  if (!accessToken) {
    return res.status(400).json({
      success: false,
      error: 'Missing required field: accessToken',
    });
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid amount - must be a positive number',
    });
  }

  if (!memo || typeof memo !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid memo',
    });
  }

  // Step 1: Validate Pi access token
  const piUser = await validatePiAccessToken(accessToken);
  if (!piUser) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired Pi access token',
    });
  }

  console.log('[createPayment] Creating payment for user:', piUser.username);

  try {
    // Step 2: Create payment on Pi Network
    const paymentResult = await createPiPayment({ amount, memo, metadata });

    const paymentId = paymentResult.identifier;
    const transactionId = paymentResult.transaction?.txid || null;
    const status = paymentResult.status || 'pending';

    console.log('[createPayment] Payment created successfully:', {
      paymentId,
      status,
      amount,
    });

    // Step 3: Store payment attempt in Supabase
    try {
      await supabase.from('orders').insert({
        pi_payment_id: paymentId,
        user_uid: piUser.uid,
        product_id: metadata?.productId || null,
        txid: transactionId,
        paid: false,
        cancelled: false,
        created_at: new Date().toISOString(),
      });
    } catch (dbError) {
      // Log DB error but don't fail the request
      console.error('[createPayment] Failed to save payment to database:', dbError);
    }

    // Step 4: Return success response
    return res.status(200).json({
      success: true,
      payment_id: paymentId,
      transaction_id: transactionId,
      status,
      amount,
      memo,
    });
  } catch (error) {
    console.error('[createPayment] Payment creation failed:', error);
    return res.status(500).json({
      success: false,
      error: (error as Error).message || 'Payment creation failed',
    });
  }
}

/**
 * Pi Network SDK Validator
 * Validates Pi authentication tokens and payment data
 */

interface AuthResult {
  user: {
    uid: string;
    username?: string;
  };
  accessToken: string;
}

interface PaymentData {
  identifier: string;
  user_uid: string;
  amount: number;
  metadata?: Record<string, any>;
}

interface ValidationResult {
  valid: boolean;
  payload: any;
}

/**
 * Validate Pi authentication response
 */
export function validatePiAuth(authResult: AuthResult): ValidationResult {
  console.log('[Pi Validator] Validating authentication:', JSON.stringify(authResult, null, 2));

  if (!authResult) {
    throw new Error('Missing authentication result');
  }

  const { user, accessToken } = authResult;

  // Validate user object
  if (!user || !user.uid) {
    throw new Error('Invalid user data: missing uid');
  }

  // Validate access token
  if (!accessToken) {
    throw new Error('Missing access token');
  }

  console.log('[Pi Validator] Authentication valid for user:', user.uid);

  return {
    valid: true,
    payload: {
      uid: user.uid,
      username: user.username || null,
      accessToken
    }
  };
}

/**
 * Validate Pi payment data
 */
export function validatePiPayment(paymentData: PaymentData): ValidationResult {
  console.log('[Pi Validator] Validating payment:', JSON.stringify(paymentData, null, 2));

  if (!paymentData || !paymentData.identifier) {
    throw new Error('Invalid payment data: missing identifier');
  }

  const { identifier, user_uid, amount, metadata } = paymentData;

  // Validate required fields
  if (!user_uid) {
    throw new Error('Invalid payment data: missing user_uid');
  }

  if (typeof amount !== 'number' || amount <= 0) {
    throw new Error('Invalid payment data: invalid amount');
  }

  console.log('[Pi Validator] Payment valid:', identifier);

  return {
    valid: true,
    payload: {
      paymentId: identifier,
      userUid: user_uid,
      amount,
      metadata: metadata || {}
    }
  };
}

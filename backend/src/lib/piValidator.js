/**
 * Pi Network SDK Validator
 * Validates Pi authentication tokens and payment data
 */

const PI_APP_ID = 'hajde-app'; // Your Pi App ID

/**
 * Validate Pi authentication response
 * @param {Object} authResult - Result from Pi.authenticate()
 * @returns {Object} { valid: boolean, payload: Object }
 */
function validatePiAuth(authResult) {
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

  // In production, you would verify the access token with Pi Platform API
  // For now, we perform basic validation
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
 * @param {Object} paymentData - Payment data from Pi SDK
 * @returns {Object} { valid: boolean, payload: Object }
 */
function validatePiPayment(paymentData) {
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

module.exports = {
  validatePiAuth,
  validatePiPayment
};

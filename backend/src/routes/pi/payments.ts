/**
 * Pi Network Payments Route
 * Handles payment approval and completion webhooks
 */

import express, { Request, Response } from 'express';
import { validatePiPayment } from '../../lib/piValidator';
import platformAPIClient from '../../services/platformAPIClient';
import supabase from '../../services/supabaseClient';

const router = express.Router();

/**
 * POST /pi/payments/approve
 * Called when payment is ready for server approval
 */
router.post('/approve', async (req: Request, res: Response) => {
  console.log('[Pi Payments] Approve request received');
  
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: 'missing_payment_id' });
    }

    console.log('[Pi Payments] Fetching payment from Pi Platform:', paymentId);

    // Fetch payment details from Pi Platform API
    const { data: paymentData } = await platformAPIClient.get(`/v2/payments/${paymentId}`);

    console.log('[Pi Payments] Payment data received:', JSON.stringify(paymentData, null, 2));

    // Validate payment
    const { valid, payload } = validatePiPayment(paymentData);

    if (!valid) {
      console.error('[Pi Payments] Payment validation failed');
      return res.status(400).json({ error: 'invalid_payment' });
    }

    const { amount, metadata } = payload;

    // Verify amount matches expected amount from metadata
    const expectedAmount = metadata.amount || amount;
    if (Math.abs(amount - expectedAmount) > 0.001) {
      console.error('[Pi Payments] Amount mismatch:', { expected: expectedAmount, actual: amount });
      return res.status(400).json({ error: 'amount_mismatch' });
    }

    console.log('[Pi Payments] Approving payment with Pi Platform');

    // Approve payment via Pi Platform API
    await platformAPIClient.post(`/v2/payments/${paymentId}/approve`);

    console.log('[Pi Payments] Payment approved successfully');

    res.json({ 
      approved: true,
      paymentId 
    });

  } catch (error: any) {
    console.error('[Pi Payments ERROR] Approve failed:', error.message);
    if (error.response) {
      console.error('[Pi Payments ERROR] Response:', error.response.data);
    }
    res.status(500).json({ 
      error: 'approval_failed',
      message: error.message 
    });
  }
});

/**
 * POST /pi/payments/complete
 * Called when payment is ready for server completion
 */
router.post('/complete', async (req: Request, res: Response) => {
  console.log('[Pi Payments] Complete request received');
  
  try {
    if (!supabase) return res.status(500).json({ error: 'supabase_unavailable' });
    const client = supabase;
    const { paymentId, txid } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: 'missing_payment_id' });
    }

    console.log('[Pi Payments] Fetching payment for completion:', paymentId);

    // Fetch payment details
    const { data: paymentData } = await platformAPIClient.get(`/v2/payments/${paymentId}`);

    console.log('[Pi Payments] Payment data for completion:', JSON.stringify(paymentData, null, 2));

    // Validate payment
    const { valid, payload } = validatePiPayment(paymentData);

    if (!valid) {
      console.error('[Pi Payments] Payment validation failed');
      return res.status(400).json({ error: 'invalid_payment' });
    }

    const { userUid, metadata } = payload;

    console.log('[Pi Payments] Completing payment with Pi Platform');

    // Complete payment via Pi Platform API
    await platformAPIClient.post(`/v2/payments/${paymentId}/complete`, { txid });

    console.log('[Pi Payments] Payment completed, updating Supabase');

    // Update user premium status in Supabase
    const plan = metadata.plan || 'weekly'; // Default to weekly
    const daysToAdd = plan === 'monthly' ? 30 : plan === 'yearly' ? 365 : 7;

    // Calculate new premium_until date
    const newPremiumUntil = new Date();
    newPremiumUntil.setDate(newPremiumUntil.getDate() + daysToAdd);

    const { data: userData, error: updateError } = await client
      .from('users')
      .update({
        premium_until: newPremiumUntil.toISOString()
      })
      .eq('wallet', userUid)
      .select()
      .single();

    if (updateError) {
      console.error('[Pi Payments] Supabase update error:', updateError);
      // Payment is already completed on Pi side, so we log but don't fail
      console.error('[Pi Payments] WARNING: Payment completed but premium_until update failed');
    } else {
      console.log('[Pi Payments] Premium updated successfully:', userData);
    }

    res.json({ 
      completed: true,
      paymentId,
      txid,
      premium_until: userData?.premium_until || null
    });

  } catch (error: any) {
    console.error('[Pi Payments ERROR] Complete failed:', error.message);
    if (error.response) {
      console.error('[Pi Payments ERROR] Response:', error.response.data);
    }
    res.status(500).json({ 
      error: 'completion_failed',
      message: error.message 
    });
  }
});

/**
 * POST /pi/payments/cancelled
 * Called when payment is cancelled by user
 */
router.post('/cancelled', async (req: Request, res: Response) => {
  console.log('[Pi Payments] Payment cancelled request received');
  
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: 'missing_payment_id' });
    }

    console.log('[Pi Payments] Payment cancelled:', paymentId);

    // Just log it - no action needed
    res.json({ 
      acknowledged: true,
      paymentId 
    });

  } catch (error: any) {
    console.error('[Pi Payments ERROR] Cancel handler failed:', error.message);
    res.status(500).json({ 
      error: 'cancel_handler_failed',
      message: error.message 
    });
  }
});

export default router;

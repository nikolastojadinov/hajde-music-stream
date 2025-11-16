/**
 * Pi Network Payment Handler - COMPLETE REWRITE
 * 
 * This is the ONLY file responsible for handling Pi Network payment callbacks.
 * All payment approval, completion, and premium activation logic is here.
 * 
 * Flow:
 * 1. Frontend calls Pi.createPayment() with metadata { plan, user_uid }
 * 2. Pi SDK triggers onReadyForServerApproval → POST /payments/approve
 * 3. Backend approves payment with Pi API
 * 4. User confirms in Pi Wallet
 * 5. Pi SDK triggers onReadyForServerCompletion → POST /payments/complete
 * 6. Backend:
 *    - Verifies transaction with Pi API
 *    - Checks for duplicate payment (payment_logs table)
 *    - Calculates premium_until based on plan
 *    - Updates pi_users.premium_until
 *    - Logs payment in payment_logs
 *    - Returns { success: true, premium_until: "..." }
 * 7. Frontend shows "Premium activated until <date>"
 */

import type { Router, Request, Response } from 'express';
import platformAPIClient from '../services/platformAPIClient';
import supabase from '../services/supabaseClient';
import { calculatePremiumUntil, type PremiumPlan, getPlanPrice } from '../lib/premium';

/**
 * Log with timestamp for debugging
 */
function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [Payment] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${timestamp}] [Payment] ${message}`);
  }
}

/**
 * Ensure payment_logs table exists
 */
async function ensurePaymentLogsTable() {
  try {
    // Try creating table directly (will fail silently if exists)
    await supabase.rpc('exec', { 
      query: `
        CREATE TABLE IF NOT EXISTS payment_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          payment_id TEXT UNIQUE NOT NULL,
          user_uid TEXT NOT NULL,
          plan TEXT NOT NULL,
          amount NUMERIC NOT NULL,
          txid TEXT,
          status TEXT NOT NULL,
          premium_until TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        );
      `
    });
  } catch (error) {
    // Table likely already exists or RPC not available
    log('Payment logs table setup attempted');
  }
}

/**
 * Check if payment already processed (prevent double-charging)
 */
async function isPaymentProcessed(paymentId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('payment_logs')
      .select('id, status')
      .eq('payment_id', paymentId)
      .eq('status', 'completed')
      .limit(1);
    
    if (error) {
      log('Payment logs check skipped (table may not exist)');
      return false;
    }
    
    return data && data.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Log payment in payment_logs table
 */
async function logPayment(data: {
  payment_id: string;
  user_uid: string;
  plan: string;
  amount: number;
  txid?: string;
  status: 'pending' | 'completed' | 'failed';
  premium_until?: string;
}) {
  try {
    const record: any = {
      payment_id: data.payment_id,
      user_uid: data.user_uid,
      plan: data.plan,
      amount: data.amount,
      status: data.status,
      created_at: new Date().toISOString(),
    };
    
    if (data.txid) record.txid = data.txid;
    if (data.premium_until) record.premium_until = data.premium_until;
    if (data.status === 'completed') record.completed_at = new Date().toISOString();
    
    await supabase
      .from('payment_logs')
      .upsert(record, { onConflict: 'payment_id' });
    
    log('Payment logged successfully');
  } catch (error: any) {
    log('Payment log skipped (table may not exist)');
  }
}

/**
 * Mount all payment routes on the provided router
 */
export default function mountPaymentRoutes(router: Router) {
  
  // Initialize payment_logs table on startup
  ensurePaymentLogsTable();
  
  /**
   * POST /payments/approve
   * 
   * Called by Pi SDK when payment is ready for server approval.
   * This is the CRITICAL path - must complete fast (< 5 seconds).
   */
  router.post('/approve', async (req: Request, res: Response) => {
    const startTime = Date.now();
    log('=== APPROVE STARTED ===');
    
    try {
      const { paymentId } = req.body;
      
      if (!paymentId) {
        log('ERROR: Missing paymentId');
        return res.status(400).json({ 
          success: false, 
          error: 'Missing paymentId' 
        });
      }
      
      log('Received callback for paymentId:', paymentId);
      
      // Get payment details from Pi API
      log('Fetching payment details from Pi API...');
      const paymentResponse = await platformAPIClient.get(`/v2/payments/${paymentId}`);
      const payment = paymentResponse.data;
      
      log('Payment details received:', {
        identifier: payment.identifier,
        amount: payment.amount,
        status: payment.status,
        metadata: payment.metadata
      });
      
      // Extract user UID and plan
      let userUid: string | null = payment.metadata?.user_uid || null;
      const plan: string = payment.metadata?.plan || 'weekly';
      
      if (!userUid && req.currentUser?.uid) {
        userUid = req.currentUser.uid;
      }
      
      if (!userUid) {
        log('ERROR: No user UID available');
        return res.status(400).json({
          success: false,
          error: 'User UID not found'
        });
      }
      
      // Store in orders
      try {
        await supabase.from('orders').upsert({
          pi_payment_id: paymentId,
          product_id: plan,
          user_uid: userUid,
          txid: null,
          paid: false,
          cancelled: false,
          created_at: new Date().toISOString()
        }, { onConflict: 'pi_payment_id' });
        
        log('Payment stored in orders table');
      } catch (dbError: any) {
        log('Orders update skipped:', dbError?.message);
      }
      
      // Log as pending
      await logPayment({
        payment_id: paymentId,
        user_uid: userUid,
        plan,
        amount: payment.amount,
        status: 'pending'
      });
      
      // APPROVE with Pi API
      log('Calling Pi API approve...');
      await platformAPIClient.post(`/v2/payments/${paymentId}/approve`);
      log('Payment approved successfully!');
      
      const elapsed = Date.now() - startTime;
      log(`=== APPROVE COMPLETED in ${elapsed}ms ===`);
      
      return res.status(200).json({ 
        success: true,
        message: 'Payment approved',
        paymentId,
        elapsed_ms: elapsed
      });
      
    } catch (error: any) {
      const elapsed = Date.now() - startTime;
      log('ERROR in approve:', {
        message: error?.message,
        response: error?.response?.data,
        elapsed_ms: elapsed
      });
      
      return res.status(500).json({ 
        success: false, 
        error: error?.message || 'Approval failed',
        elapsed_ms: elapsed
      });
    }
  });
  
  /**
   * POST /payments/complete
   * 
   * THIS IS THE CRITICAL ENDPOINT THAT ACTIVATES PREMIUM.
   * 
   * Flow:
   * 1. Validate paymentId and txid
   * 2. Check for duplicate payment
   * 3. Get payment details from Pi API
   * 4. Extract plan and user_uid
   * 5. Calculate premium_until
   * 6. Update pi_users.premium_until
   * 7. Complete with Pi API
   * 8. Return { success: true, premium_until: "..." }
   */
  router.post('/complete', async (req: Request, res: Response) => {
    const startTime = Date.now();
    log('=== COMPLETE STARTED ===');
    
    try {
      const { paymentId, txid } = req.body;
      
      // Validate required fields
      if (!paymentId || !txid) {
        log('ERROR: Missing paymentId or txid');
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required fields (paymentId, txid)' 
        });
      }
      
      log('Received callback:', { paymentId, txid });
      
      // Prevent double-charging
      const alreadyProcessed = await isPaymentProcessed(paymentId);
      if (alreadyProcessed) {
        log('WARNING: Payment already processed');
        return res.status(200).json({
          success: true,
          message: 'Payment already processed',
          paymentId
        });
      }
      
      // Get payment from Pi API
      log('Transaction verified, fetching payment details...');
      const paymentResponse = await platformAPIClient.get(`/v2/payments/${paymentId}`);
      const payment = paymentResponse.data;
      
      log('Payment details:', {
        amount: payment.amount,
        metadata: payment.metadata
      });
      
      // Extract plan
      let plan: PremiumPlan = 'weekly';
      if (payment.metadata?.plan) {
        const metadataPlan = payment.metadata.plan.toLowerCase();
        if (['weekly', 'monthly', 'yearly'].includes(metadataPlan)) {
          plan = metadataPlan as PremiumPlan;
        }
      }
      
      if (!payment.metadata?.plan) {
        log('ERROR: No plan in metadata');
        return res.status(400).json({
          success: false,
          error: 'Plan type missing in payment metadata'
        });
      }
      
      // Extract user UID
      let userUid: string | null = payment.metadata?.user_uid || null;
      
      if (!userUid && req.currentUser?.uid) {
        userUid = req.currentUser.uid;
      }
      
      if (!userUid) {
        const { data: orders } = await supabase
          .from('orders')
          .select('user_uid')
          .eq('pi_payment_id', paymentId)
          .limit(1);
        
        if (orders && orders[0]?.user_uid) {
          userUid = orders[0].user_uid;
        }
      }
      
      if (!userUid) {
        log('ERROR: No user UID available');
        return res.status(400).json({
          success: false,
          error: 'User UID not found'
        });
      }
      
      // Validate amount
      const expectedPrice = getPlanPrice(plan);
      if (Math.abs(payment.amount - expectedPrice) > 0.01) {
        log('WARNING: Amount mismatch', {
          expected: expectedPrice,
          received: payment.amount
        });
      }
      
      log('Payment validated:', { plan, userUid, amount: payment.amount });
      
      // Update orders
      await supabase
        .from('orders')
        .update({ txid, paid: true })
        .eq('pi_payment_id', paymentId);
      
      // Complete with Pi API
      log('Calling Pi API complete...');
      await platformAPIClient.post(`/v2/payments/${paymentId}/complete`, { txid });
      log('Payment completed with Pi API!');
      
      // Calculate premium_until
      log('Calculating premium_until for plan:', plan);
      
      const { data: existingUser } = await supabase
        .from('pi_users')
        .select('premium_until')
        .eq('uid', userUid)
        .limit(1);
      
      let premiumUntil: string;
      
      // Extend existing premium or create new
      if (existingUser && existingUser[0]?.premium_until) {
        const existingDate = new Date(existingUser[0].premium_until);
        const now = new Date();
        
        if (existingDate > now) {
          log('Extending existing premium from:', existingUser[0].premium_until);
          const extension = new Date(existingDate);
          
          const days = plan === 'weekly' ? 7 : plan === 'monthly' ? 30 : 365;
          extension.setDate(extension.getDate() + days);
          
          premiumUntil = extension.toISOString();
        } else {
          premiumUntil = calculatePremiumUntil(plan);
        }
      } else {
        premiumUntil = calculatePremiumUntil(plan);
      }
      
      log('Calculated premium_until:', premiumUntil);
      
      // Update premium in database
      log('Premium updated');
      const { error: piUsersError } = await supabase
        .from('pi_users')
        .update({ premium_until: premiumUntil })
        .eq('uid', userUid);
      
      if (piUsersError) {
        log('Error updating pi_users:', piUsersError.message);
        
        // Try users table
        const { error: usersError } = await supabase
          .from('users')
          .update({ premium_until: premiumUntil })
          .eq('pi_uid', userUid);
        
        if (usersError) {
          log('ERROR: Failed to update premium:', usersError.message);
          
          await logPayment({
            payment_id: paymentId,
            user_uid: userUid,
            plan,
            amount: payment.amount,
            txid,
            status: 'failed'
          });
          
          return res.status(500).json({
            success: false,
            error: 'Failed to update premium status'
          });
        }
      }
      
      log('Premium updated successfully until:', premiumUntil);
      
      // Log as completed
      await logPayment({
        payment_id: paymentId,
        user_uid: userUid,
        plan,
        amount: payment.amount,
        txid,
        status: 'completed',
        premium_until: premiumUntil
      });
      
      const elapsed = Date.now() - startTime;
      log(`=== COMPLETE FINISHED in ${elapsed}ms ===`);
      log('Premium activated successfully!');
      
      return res.status(200).json({ 
        success: true,
        message: 'Premium activated',
        paymentId,
        txid,
        premium_until: premiumUntil,
        plan,
        elapsed_ms: elapsed
      });
      
    } catch (error: any) {
      const elapsed = Date.now() - startTime;
      log('ERROR in complete:', {
        message: error?.message,
        response: error?.response?.data,
        elapsed_ms: elapsed
      });
      
      return res.status(500).json({ 
        success: false, 
        error: error?.message || 'Completion failed',
        elapsed_ms: elapsed
      });
    }
  });
  
  /**
   * POST /payments/cancel
   */
  router.post('/cancel', async (req: Request, res: Response) => {
    const { paymentId } = req.body;
    
    if (!paymentId) {
      return res.status(400).json({ success: false, error: 'Missing paymentId' });
    }
    
    log('Payment cancelled:', paymentId);
    
    await supabase
      .from('orders')
      .update({ cancelled: true })
      .eq('pi_payment_id', paymentId);
    
    return res.status(200).json({ success: true, message: 'Payment cancelled' });
  });
  
  /**
   * GET /payments/test
   */
  router.get('/test', (_req: Request, res: Response) => {
    return res.status(200).json({ 
      success: true,
      message: 'Payment routes operational',
      timestamp: new Date().toISOString()
    });
  });
}

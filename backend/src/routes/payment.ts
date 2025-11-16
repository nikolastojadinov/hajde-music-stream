/**
 * Pi Network Payment Routes (CLEAN REWRITE)
 * 
 * This module handles the complete Pi payment flow:
 * 1. Payment approval (onReadyForServerApproval callback)
 * 2. Payment completion (onReadyForServerCompletion callback)
 * 3. Payment cancellation handling
 * 
 * CRITICAL: All operations must complete within 30 seconds to avoid wallet timeout.
 */

import type { Router, Request, Response } from 'express';
import platformAPIClient from '../services/platformAPIClient';
import supabase from '../services/supabaseClient';
import { calculatePremiumUntil, type PremiumPlan } from '../lib/premium';

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
 * Mount all payment routes on the provided router
 */
export default function mountPaymentRoutes(router: Router) {
  
  /**
   * POST /payments/approve
   * 
   * Called by Pi SDK when payment is ready for server approval.
   * This is the CRITICAL path - must complete fast (< 5 seconds).
   * 
   * Flow:
   * 1. Validate paymentId
   * 2. Fetch payment details from Pi API
   * 3. Store payment in database
   * 4. Approve payment with Pi API
   * 5. Return success immediately
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
      
      log('Received paymentId:', paymentId);
      
      // Step 1: Get payment details from Pi API
      log('Fetching payment details from Pi API...');
      const paymentResponse = await platformAPIClient.get(`/v2/payments/${paymentId}`);
      const payment = paymentResponse.data;
      
      log('Payment details received:', {
        identifier: payment.identifier,
        amount: payment.amount,
        status: payment.status,
        metadata: payment.metadata
      });
      
      // Step 2: Determine user from current session or payment metadata
      let userUid: string | null = null;
      
      if (req.currentUser?.uid) {
        userUid = req.currentUser.uid;
        log('User from session:', userUid);
      } else if (payment.metadata?.user_uid) {
        userUid = payment.metadata.user_uid;
        log('User from payment metadata:', userUid);
      }
      
      // Step 3: Store payment in database
      log('Storing payment in database...');
      try {
        const { error: dbError } = await supabase.from('orders').upsert({
          pi_payment_id: paymentId,
          product_id: payment.metadata?.productId || payment.metadata?.product_id || null,
          user_uid: userUid,
          txid: null,
          paid: false,
          cancelled: false,
          created_at: new Date().toISOString()
        }, { 
          onConflict: 'pi_payment_id' 
        });
        
        if (dbError) {
          log('Database error (non-critical):', dbError);
        } else {
          log('Payment stored in database successfully');
        }
      } catch (dbError) {
        // Don't fail the approval if DB fails
        log('Database error (non-critical, continuing):', dbError);
      }
      
      // Step 4: APPROVE the payment with Pi API (CRITICAL)
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
   * Called by Pi SDK when payment has a transaction ID.
   * Must complete the payment with Pi API and update database.
   * 
   * CRITICAL: This updates the user's premium_until in the database!
   * 
   * Flow:
   * 1. Validate paymentId and txid
   * 2. Get payment details from Pi API to extract metadata
   * 3. Determine plan from metadata
   * 4. Calculate premium_until using helper
   * 5. Update database with txid, paid status, AND premium_until
   * 6. Complete payment with Pi API
   * 7. Return success with premium_until
   */
  router.post('/complete', async (req: Request, res: Response) => {
    const startTime = Date.now();
    log('=== COMPLETE STARTED ===');
    
    try {
      const { paymentId, txid } = req.body;
      
      if (!paymentId || !txid) {
        log('ERROR: Missing paymentId or txid');
        return res.status(400).json({ 
          success: false, 
          error: 'Missing paymentId or txid' 
        });
      }
      
      log('Completing payment:', { paymentId, txid });
      
      // Step 1: Get payment details from Pi API to extract plan from metadata
      log('Fetching payment details from Pi API...');
      let plan: PremiumPlan = 'weekly'; // default
      let userUid: string | null = null;
      
      try {
        const paymentResponse = await platformAPIClient.get(`/v2/payments/${paymentId}`);
        const payment = paymentResponse.data;
        
        log('Payment metadata:', payment.metadata);
        
        // Extract plan from metadata
        if (payment.metadata?.plan) {
          const metadataPlan = payment.metadata.plan.toLowerCase();
          if (metadataPlan === 'weekly' || metadataPlan === 'monthly' || metadataPlan === 'yearly') {
            plan = metadataPlan as PremiumPlan;
          }
        }
        
        // Extract user UID
        if (payment.metadata?.user_uid) {
          userUid = payment.metadata.user_uid;
        }
        
        log('Extracted from payment:', { plan, userUid });
      } catch (error: any) {
        log('Error fetching payment details (using defaults):', error?.message);
      }
      
      // Step 2: Get user UID from session if not in metadata
      if (!userUid && req.currentUser?.uid) {
        userUid = req.currentUser.uid;
        log('Using user from session:', userUid);
      }
      
      // Step 3: Update database with transaction ID
      log('Updating database with txid...');
      const { data: orders, error: fetchError } = await supabase
        .from('orders')
        .select('*')
        .eq('pi_payment_id', paymentId)
        .limit(1);
      
      if (fetchError) {
        log('Error fetching order:', fetchError);
      }
      
      const order = orders && orders[0];
      
      // If we have product_id in order, try to extract plan from it
      if (order?.product_id && !plan) {
        const productId = order.product_id.toLowerCase();
        if (productId.includes('weekly')) plan = 'weekly';
        else if (productId.includes('monthly')) plan = 'monthly';
        else if (productId.includes('yearly')) plan = 'yearly';
      }
      
      // If we have user_uid in order, use it
      if (order?.user_uid && !userUid) {
        userUid = order.user_uid;
      }
      
      const { error: updateError } = await supabase
        .from('orders')
        .update({ 
          txid, 
          paid: true 
        })
        .eq('pi_payment_id', paymentId);
      
      if (updateError) {
        log('Error updating order (non-critical):', updateError);
      } else {
        log('Database updated with txid successfully');
      }
      
      // Step 4: Complete payment with Pi API
      log('Calling Pi API complete...');
      await platformAPIClient.post(`/v2/payments/${paymentId}/complete`, { txid });
      log('Payment completed with Pi API successfully!');
      
      // Step 5: CRITICAL - Update user premium status
      let premiumUntil: string | null = null;
      
      if (userUid) {
        log('Calculating premium_until for plan:', plan);
        premiumUntil = calculatePremiumUntil(plan);
        
        log('Updating user premium status...', { 
          user_uid: userUid, 
          plan,
          premium_until: premiumUntil
        });
        
        try {
          // Try updating pi_users first
          const { error: premiumError } = await supabase
            .from('pi_users')
            .update({ premium_until: premiumUntil })
            .eq('uid', userUid);
          
          if (premiumError) {
            log('Error updating pi_users premium (trying users table):', premiumError);
            
            // Try users table as fallback
            const { error: usersError } = await supabase
              .from('users')
              .update({ premium_until: premiumUntil })
              .eq('pi_uid', userUid);
            
            if (usersError) {
              log('Error updating users premium:', usersError);
            } else {
              log('Premium status updated in users table until:', premiumUntil);
            }
          } else {
            log('Premium status updated in pi_users table until:', premiumUntil);
          }
        } catch (premiumError) {
          log('Error updating premium (non-critical):', premiumError);
        }
      } else {
        log('WARNING: No user UID available, cannot update premium status');
      }
      
      const elapsed = Date.now() - startTime;
      log(`=== COMPLETE FINISHED in ${elapsed}ms ===`);
      
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
   * 
   * Called when user cancels the payment.
   */
  router.post('/cancel', async (req: Request, res: Response) => {
    log('=== CANCEL STARTED ===');
    
    try {
      const { paymentId } = req.body;
      
      if (!paymentId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing paymentId' 
        });
      }
      
      log('Cancelling payment:', paymentId);
      
      // Mark as cancelled in database
      const { error } = await supabase
        .from('orders')
        .update({ cancelled: true })
        .eq('pi_payment_id', paymentId);
      
      if (error) {
        log('Error marking payment as cancelled:', error);
      } else {
        log('Payment marked as cancelled in database');
      }
      
      log('=== CANCEL COMPLETED ===');
      
      return res.status(200).json({ 
        success: true,
        message: 'Payment cancelled',
        paymentId
      });
      
    } catch (error: any) {
      log('ERROR in cancel:', error?.message);
      
      return res.status(500).json({ 
        success: false, 
        error: error?.message || 'Cancel operation failed'
      });
    }
  });
  
  /**
   * POST /payments/incomplete
   * 
   * Handle incomplete payments found by Pi SDK.
   */
  router.post('/incomplete', async (req: Request, res: Response) => {
    log('=== INCOMPLETE PAYMENT HANDLER ===');
    
    try {
      const { payment } = req.body;
      
      if (!payment?.identifier) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid payment data' 
        });
      }
      
      const paymentId = payment.identifier;
      const txid = payment.transaction?.txid;
      
      log('Incomplete payment:', { paymentId, txid });
      
      // If we have a txid, try to complete it
      if (txid) {
        log('Payment has txid, attempting to complete...');
        
        await supabase
          .from('orders')
          .update({ txid, paid: true })
          .eq('pi_payment_id', paymentId);
        
        await platformAPIClient.post(`/v2/payments/${paymentId}/complete`, { txid });
        
        log('Incomplete payment completed successfully');
        
        return res.status(200).json({ 
          success: true,
          message: 'Incomplete payment completed',
          paymentId
        });
      } else {
        log('Incomplete payment has no txid, cannot complete');
        
        return res.status(200).json({ 
          success: false,
          message: 'Payment incomplete, no transaction ID',
          paymentId
        });
      }
      
    } catch (error: any) {
      log('ERROR in incomplete:', error?.message);
      
      return res.status(500).json({ 
        success: false, 
        error: error?.message || 'Incomplete payment handling failed'
      });
    }
  });
  
  /**
   * GET /payments/test
   * 
   * Health check endpoint
   */
  router.get('/test', (_req: Request, res: Response) => {
    return res.status(200).json({ 
      success: true,
      message: 'Payment routes operational',
      timestamp: new Date().toISOString()
    });
  });
}

import type { Router, Request, Response } from 'express';
import platformAPIClient from '../services/platformAPIClient';
import supabase from '../services/supabaseClient';
import { calculatePremiumUntil, type PremiumPlan, getPlanPrice } from '../lib/premium';

function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [Payment] ${message}`, data ? JSON.stringify(data) : '');
}

async function findUserByPiUid(piUid: string) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('pi_uid', piUid)
    .single();
  
  if (error || !data) {
    log('User lookup failed', { pi_uid: piUid, error: error?.message });
    return null;
  }
  
  return data;
}

async function isPaymentProcessed(paymentId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('payment_logs')
      .select('id')
      .eq('payment_id', paymentId)
      .eq('status', 'completed')
      .limit(1);
    return !!(data && data.length > 0);
  } catch {
    return false;
  }
}

async function logPayment(data: {
  payment_id: string;
  pi_uid: string;
  plan: string;
  amount: number;
  txid?: string;
  status: 'pending' | 'completed' | 'failed';
  premium_until?: string;
}) {
  try {
    await supabase.from('payment_logs').upsert({
      payment_id: data.payment_id,
      user_uid: data.pi_uid,
      plan: data.plan,
      amount: data.amount,
      txid: data.txid || null,
      status: data.status,
      premium_until: data.premium_until || null,
      created_at: new Date().toISOString(),
      completed_at: data.status === 'completed' ? new Date().toISOString() : null
    }, { onConflict: 'payment_id' });
  } catch (error: any) {
    log('Payment log error (non-critical)', error?.message);
  }
}

export default function mountPaymentRoutes(router: Router) {
  
  router.post('/approve', async (req: Request, res: Response) => {
    const startTime = Date.now();
    log('=== APPROVE START ===');
    
    try {
      const { paymentId } = req.body;
      
      if (!paymentId) {
        return res.status(400).json({ success: false, error: 'Missing paymentId' });
      }
      
      log('Approve request', { paymentId });
      
      const paymentResponse = await platformAPIClient.get(`/v2/payments/${paymentId}`);
      const payment = paymentResponse.data;
      
      const piUid = payment.metadata?.user_uid;
      if (!piUid) {
        log('ERROR: Missing Pi UID in metadata');
        return res.status(400).json({ success: false, error: 'Missing Pi UID' });
      }
      
      const user = await findUserByPiUid(piUid);
      if (!user) {
        log('ERROR: User not found');
        return res.status(404).json({ success: false, error: 'User UID not found' });
      }
      
      const plan = payment.metadata?.plan || 'weekly';
      
      await supabase.from('orders').upsert({
        pi_payment_id: paymentId,
        product_id: plan,
        user_uid: piUid,
        txid: null,
        paid: false,
        cancelled: false,
        created_at: new Date().toISOString()
      }, { onConflict: 'pi_payment_id' });
      
      await logPayment({
        payment_id: paymentId,
        pi_uid: piUid,
        plan,
        amount: payment.amount,
        status: 'pending'
      });
      
      await platformAPIClient.post(`/v2/payments/${paymentId}/approve`);
      
      const elapsed = Date.now() - startTime;
      log('=== APPROVE SUCCESS ===', { elapsed_ms: elapsed });
      
      return res.status(200).json({ success: true, message: 'Payment approved', elapsed_ms: elapsed });
      
    } catch (error: any) {
      log('ERROR in approve', error?.message);
      return res.status(500).json({ success: false, error: error?.message || 'Approval failed' });
    }
  });
  
  router.post('/complete', async (req: Request, res: Response) => {
    const startTime = Date.now();
    log('=== COMPLETE START ===');
    
    try {
      const { paymentId, txid } = req.body;
      
      if (!paymentId || !txid) {
        return res.status(400).json({ success: false, error: 'Missing paymentId or txid' });
      }
      
      log('Complete request', { paymentId, txid });
      
      if (await isPaymentProcessed(paymentId)) {
        log('Payment already processed');
        return res.status(200).json({ success: true, message: 'Already processed' });
      }
      
      const paymentResponse = await platformAPIClient.get(`/v2/payments/${paymentId}`);
      const payment = paymentResponse.data;
      
      const piUid = payment.metadata?.user_uid;
      if (!piUid) {
        log('ERROR: Missing Pi UID in metadata');
        return res.status(400).json({ success: false, error: 'Missing Pi UID' });
      }
      
      const user = await findUserByPiUid(piUid);
      if (!user) {
        log('ERROR: User not found');
        return res.status(404).json({ success: false, error: 'User UID not found' });
      }
      
      const planFromMetadata = payment.metadata?.plan;
      if (!planFromMetadata) {
        log('ERROR: No plan in metadata');
        return res.status(400).json({ success: false, error: 'Plan missing in metadata' });
      }
      
      let plan: PremiumPlan = 'weekly';
      const planLower = planFromMetadata.toLowerCase();
      if (['weekly', 'monthly', 'yearly'].includes(planLower)) {
        plan = planLower as PremiumPlan;
      }
      
      const expectedPrice = getPlanPrice(plan);
      if (Math.abs(payment.amount - expectedPrice) > 0.01) {
        log('WARNING: Amount mismatch', { expected: expectedPrice, received: payment.amount });
      }
      
      await supabase
        .from('orders')
        .update({ txid, paid: true })
        .eq('pi_payment_id', paymentId);
      
      await platformAPIClient.post(`/v2/payments/${paymentId}/complete`, { txid });
      
      log('Calculating premium_until', { plan, pi_uid: piUid });
      
      const { data: existingUser } = await supabase
        .from('users')
        .select('premium_until')
        .eq('pi_uid', piUid)
        .single();
      
      let premiumUntil: string;
      
      if (existingUser?.premium_until) {
        const existingDate = new Date(existingUser.premium_until);
        const now = new Date();
        
        if (existingDate > now) {
          const extension = new Date(existingDate);
          const days = plan === 'weekly' ? 7 : plan === 'monthly' ? 30 : 365;
          extension.setDate(extension.getDate() + days);
          premiumUntil = extension.toISOString();
          log('Extending premium', { from: existingUser.premium_until, to: premiumUntil });
        } else {
          premiumUntil = calculatePremiumUntil(plan);
        }
      } else {
        premiumUntil = calculatePremiumUntil(plan);
      }
      
      const { error: updateError } = await supabase
        .from('users')
        .update({ premium_until: premiumUntil })
        .eq('pi_uid', piUid);
      
      if (updateError) {
        log('ERROR: Failed to update premium', updateError.message);
        
        await logPayment({
          payment_id: paymentId,
          pi_uid: piUid,
          plan,
          amount: payment.amount,
          txid,
          status: 'failed'
        });
        
        return res.status(500).json({ success: false, error: 'Failed to update premium status' });
      }
      
      log('Premium updated', { pi_uid: piUid, premium_until: premiumUntil });
      
      await logPayment({
        payment_id: paymentId,
        pi_uid: piUid,
        plan,
        amount: payment.amount,
        txid,
        status: 'completed',
        premium_until: premiumUntil
      });
      
      const elapsed = Date.now() - startTime;
      log('=== COMPLETE SUCCESS ===', { elapsed_ms: elapsed });
      
      return res.status(200).json({
        success: true,
        message: 'Premium activated',
        premium_until: premiumUntil,
        plan,
        elapsed_ms: elapsed
      });
      
    } catch (error: any) {
      log('ERROR in complete', error?.message);
      return res.status(500).json({ success: false, error: error?.message || 'Completion failed' });
    }
  });
  
  router.post('/cancel', async (req: Request, res: Response) => {
    const { paymentId } = req.body;
    if (!paymentId) {
      return res.status(400).json({ success: false, error: 'Missing paymentId' });
    }
    
    await supabase.from('orders').update({ cancelled: true }).eq('pi_payment_id', paymentId);
    
    return res.status(200).json({ success: true, message: 'Payment cancelled' });
  });
  
  router.get('/test', (_req: Request, res: Response) => {
    return res.status(200).json({ success: true, message: 'Payment routes operational' });
  });
}

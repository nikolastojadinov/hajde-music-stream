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

async function resolvePaymentContext(paymentId: string): Promise<{
  payment: any;
  piUid: string | null;
  plan: PremiumPlan;
}> {
  log('resolvePaymentContext START', { payment_id: paymentId });

  // a) Pozovi Pi Platform API
  const paymentResponse = await platformAPIClient.get(`/v2/payments/${paymentId}`);
  const payment = paymentResponse.data;

  // DETALJNO LOGOVANJE - vidi šta tačno stigne od Pi Platform API
  log('Pi Platform API response (FULL PAYMENT OBJECT):', {
    payment_id: paymentId,
    full_payment: payment,
    payment_metadata: payment?.metadata,
    payment_user: payment?.user,
    payment_amount: payment?.amount,
    payment_memo: payment?.memo,
  });

  // b) Pokušaj da pročitaš piUid iz payment objekta
  let piUid: string | null = payment?.metadata?.user_uid ?? null;
  if (!piUid && payment?.user?.uid) {
    piUid = payment.user.uid;
  }

  // c) Pokušaj da pročitaš plan iz payment.metadata.plan
  let planStr: string | null = payment?.metadata?.plan ?? null;

  // d) Ako piUid ili planStr i dalje fale, pokušaj iz Supabase public.orders
  if (!piUid || !planStr) {
    const { data: order } = await supabase
      .from('orders')
      .select('user_uid, product_id')
      .eq('pi_payment_id', paymentId)
      .single();

    if (order) {
      if (!piUid && order.user_uid) piUid = order.user_uid;
      if (!planStr && order.product_id) planStr = order.product_id;
    }

    log('resolvePaymentContext: Checked orders table', {
      payment_id: paymentId,
      order_found: !!order,
      order_user_uid: order?.user_uid,
      order_product_id: order?.product_id,
    });
  }

  // e) Normalize plan: default 'weekly' ako fali ili nije validna vrednost
  if (!planStr) {
    planStr = 'weekly';
  } else {
    planStr = planStr.toLowerCase();
    if (!['weekly', 'monthly', 'yearly'].includes(planStr)) {
      planStr = 'weekly';
    }
  }
  const plan: PremiumPlan = planStr as PremiumPlan;

  log('resolvePaymentContext RESULT', {
    payment_id: paymentId,
    has_metadata_user_uid: !!payment?.metadata?.user_uid,
    has_payment_user_uid: !!payment?.user?.uid,
    resolved_piUid: piUid,
    resolved_plan: plan,
  });

  return { payment, piUid, plan };
}

export default function mountPaymentRoutes(router: Router) {
  router.post('/approve', async (req: Request, res: Response) => {
    const startTime = Date.now();
    log('=== APPROVE START ===');

    try {
      const { paymentId } = req.body;
      if (!paymentId) {
        log('ERROR: Missing paymentId in body');
        return res.status(400).json({ success: false, error: 'Missing paymentId' });
      }

      const { payment, piUid, plan } = await resolvePaymentContext(paymentId);

      if (!piUid) {
        log('ERROR: Missing Pi UID after resolvePaymentContext', { paymentId });
        return res.status(400).json({ success: false, error: 'Missing Pi UID' });
      }

      const user = await findUserByPiUid(piUid);
      if (!user) {
        log('ERROR: User UID not found in database', { pi_uid: piUid });
        return res.status(404).json({ success: false, error: 'User UID not found' });
      }

      await supabase.from('orders').upsert({
        pi_payment_id: paymentId,
        product_id: plan,
        user_uid: piUid,
        txid: null,
        paid: false,
        cancelled: false,
        created_at: new Date().toISOString(),
      }, { onConflict: 'pi_payment_id' });

      await logPayment({
        payment_id: paymentId,
        pi_uid: piUid,
        plan,
        amount: payment.amount,
        status: 'pending',
      });

      log('Approving payment on Pi Platform', { payment_id: paymentId });
      await platformAPIClient.post(`/v2/payments/${paymentId}/approve`);

      const elapsed = Date.now() - startTime;
      log('=== APPROVE SUCCESS ===', { payment_id: paymentId, elapsed_ms: elapsed });

      return res.status(200).json({
        success: true,
        message: 'Payment approved',
        elapsed_ms: elapsed,
      });
    } catch (error: any) {
      log('ERROR in approve', error?.message || error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Approval failed',
      });
    }
  });

  router.post('/complete', async (req: Request, res: Response) => {
    const startTime = Date.now();
    log('=== COMPLETE START ===');

    try {
      const { paymentId, txid } = req.body;
      if (!paymentId || !txid) {
        log('ERROR: Missing paymentId or txid');
        return res.status(400).json({ success: false, error: 'Missing paymentId or txid' });
      }

      const alreadyProcessed = await isPaymentProcessed(paymentId);
      if (alreadyProcessed) {
        log('Payment already processed (duplicate prevention)', { payment_id: paymentId });
        return res.status(200).json({
          success: true,
          message: 'Payment already processed',
        });
      }

      const { payment, piUid, plan } = await resolvePaymentContext(paymentId);

      if (!piUid) {
        log('ERROR: Missing Pi UID after resolvePaymentContext', { paymentId });
        return res.status(400).json({ success: false, error: 'Missing Pi UID' });
      }

      const user = await findUserByPiUid(piUid);
      if (!user) {
        log('ERROR: User UID not found in database', { pi_uid: piUid });
        return res.status(404).json({ success: false, error: 'User UID not found' });
      }

      const expectedPrice = getPlanPrice(plan);
      if (Math.abs(payment.amount - expectedPrice) > 0.01) {
        log('WARNING: Payment amount mismatch', {
          payment_id: paymentId,
          expected: expectedPrice,
          received: payment.amount,
        });
      }

      await supabase
        .from('orders')
        .update({ txid, paid: true })
        .eq('pi_payment_id', paymentId);

      log('Completing payment on Pi Platform', { payment_id: paymentId, txid });
      await platformAPIClient.post(`/v2/payments/${paymentId}/complete`, { txid });

      let premiumUntil: string;
      const currentPremium = user.premium_until ? new Date(user.premium_until) : null;
      const now = new Date();

      if (currentPremium && currentPremium > now) {
        const daysToAdd = plan === 'weekly' ? 7 : plan === 'monthly' ? 30 : 365;
        const extendedDate = new Date(currentPremium);
        extendedDate.setDate(extendedDate.getDate() + daysToAdd);
        premiumUntil = extendedDate.toISOString();
        log('Extending existing premium', { from: currentPremium.toISOString(), to: premiumUntil });
      } else {
        premiumUntil = calculatePremiumUntil(plan);
        log('Setting new premium', { until: premiumUntil });
      }

      const { error: updateError } = await supabase
        .from('users')
        .update({ premium_until: premiumUntil })
        .eq('pi_uid', piUid);

      if (updateError) {
        log('ERROR: Failed to update premium_until', { pi_uid: piUid, error: updateError.message });
        await logPayment({
          payment_id: paymentId,
          pi_uid: piUid,
          plan,
          amount: payment.amount,
          txid,
          status: 'failed',
        });
        return res.status(500).json({ success: false, error: 'Failed to activate premium' });
      }

      await logPayment({
        payment_id: paymentId,
        pi_uid: piUid,
        plan,
        amount: payment.amount,
        txid,
        status: 'completed',
        premium_until: premiumUntil,
      });

      const elapsed = Date.now() - startTime;
      log('=== COMPLETE SUCCESS ===', {
        payment_id: paymentId,
        premium_until: premiumUntil,
        elapsed_ms: elapsed,
      });

      return res.status(200).json({
        success: true,
        message: 'Premium activated',
        premium_until: premiumUntil,
        plan,
        elapsed_ms: elapsed,
      });
    } catch (error: any) {
      log('ERROR in complete', error?.message || error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Completion failed',
      });
    }
  });

  router.post('/cancel', async (req: Request, res: Response) => {
    try {
      const { paymentId } = req.body;
      if (!paymentId) {
        return res.status(400).json({ success: false, error: 'Missing paymentId' });
      }

      log('Payment cancelled by user', { payment_id: paymentId });

      await supabase
        .from('orders')
        .update({ cancelled: true })
        .eq('pi_payment_id', paymentId);

      return res.status(200).json({ success: true, message: 'Payment cancelled' });
    } catch (error: any) {
      log('ERROR in cancel', error?.message || error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Cancel failed',
      });
    }
  });

  router.get('/test', (_req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      message: 'Payment routes operational',
    });
  });
}

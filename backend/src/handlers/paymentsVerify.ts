import { Router } from 'express';
import platformAPIClient from '../services/platformAPIClient';
import supabase from '../services/supabaseClient';

export default function mountPaymentsVerify(router: Router) {
  // Verify Pi payment and update premium status
  router.post('/verify', async (req, res) => {
    try {
      const { paymentId, plan, amount, user } = req.body || {};
      if (!paymentId || !amount || !user?.username) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Verify payment with Pi Platform API
      const { data: payment } = await platformAPIClient.get(`/v2/payments/${paymentId}`);

      const completedFlag = (payment?.status?.developer_completed === true) || (payment?.status === 'completed');
      const verifiedFlag = (payment?.status?.transaction_verified === true) || (payment?.transaction_verified === true) || Boolean(payment?.transaction?.verified);
      if (!completedFlag && !verifiedFlag) {
        return res.status(400).json({ error: 'Payment not completed or unverified' });
      }

      // Calculate premium_until by plan
      const now = new Date();
      const premiumUntil = new Date(now);
      if (plan === 'monthly') premiumUntil.setMonth(now.getMonth() + 1);
      else if (plan === 'yearly') premiumUntil.setFullYear(now.getFullYear() + 1);
      else premiumUntil.setDate(now.getDate() + 7); // default weekly

      // Insert payment record
      const { error: paymentError } = await supabase.from('payments').insert([
        {
          user_name: user.username,
          plan,
          amount,
          payment_id: paymentId,
          status: 'completed',
          completed_at: now.toISOString(),
        },
      ]);
      if (paymentError) {
        console.error('Failed to insert payment:', paymentError);
        return res.status(500).json({ error: 'Database insert error' });
      }

      // Update user's premium_until
      const { error: userError } = await supabase
        .from('users')
        .update({ premium_until: premiumUntil.toISOString() })
        .eq('username', user.username);
      if (userError) {
        console.error('Failed to update user premium_until:', userError);
        return res.status(500).json({ error: 'User update failed' });
      }

      return res.status(200).json({ success: true, premium_until: premiumUntil.toISOString() });
    } catch (err: any) {
      console.error('Payment verification failed:', err?.message || err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
}

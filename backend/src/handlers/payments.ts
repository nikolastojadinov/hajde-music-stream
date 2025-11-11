import axios from "axios";
import { Router } from "express";
import platformAPIClient from "../services/platformAPIClient";
import supabase from "../services/supabaseClient";

export default function mountPaymentsEndpoints(router: Router) {
  // quick test endpoint
  router.get('/test', (_req, res) => {
    return res.status(200).json({ message: 'Pi SDK integrated OK' });
  });

  // handle the incomplete payment
  router.post('/incomplete', async (req, res) => {
    const payment = req.body.payment;
    const paymentId = payment.identifier;
    const txid = payment.transaction && payment.transaction.txid;
    const txURL = payment.transaction && payment.transaction._link;

    // find the incomplete order
    const { data: orders } = await supabase.from('orders').select('*').eq('pi_payment_id', paymentId).limit(1);
    const order = orders && orders[0];
    if (!order) {
      return res.status(400).json({ message: "Order not found" });
    }

    // check the transaction on the Pi blockchain
    if (txURL) {
      const horizonResponse = await axios.create({ timeout: 20000 }).get(txURL);
      const paymentIdOnBlock = horizonResponse.data.memo;
      if (paymentIdOnBlock !== order.pi_payment_id) {
        return res.status(400).json({ message: "Payment id doesn't match." });
      }
    }

    await supabase.from('orders').update({ txid, paid: true }).eq('pi_payment_id', paymentId);
    await platformAPIClient.post(`/v2/payments/${paymentId}/complete`, { txid });
    return res.status(200).json({ message: `Handled the incomplete payment ${paymentId}` });
  });

  // approve the current payment
  router.post('/approve', async (req, res) => {
    if (!req.currentUser) {
      return res.status(401).json({ error: 'unauthorized', message: "User needs to sign in first" });
    }

    const paymentId = req.body.paymentId;
    const currentPayment = await platformAPIClient.get(`/v2/payments/${paymentId}`);

    await supabase.from('orders').upsert({
      pi_payment_id: paymentId,
      product_id: currentPayment.data?.metadata?.productId ?? null,
      user_uid: req.currentUser.uid,
      txid: null,
      paid: false,
      cancelled: false,
      created_at: new Date().toISOString()
    }, { onConflict: 'pi_payment_id' });

    await platformAPIClient.post(`/v2/payments/${paymentId}/approve`);
    return res.status(200).json({ message: `Approved the payment ${paymentId}` });
  });

  // complete the current payment
  router.post('/complete', async (req, res) => {
    const paymentId = req.body.paymentId;
    const txid = req.body.txid;

    await supabase.from('orders').update({ txid, paid: true }).eq('pi_payment_id', paymentId);
    await platformAPIClient.post(`/v2/payments/${paymentId}/complete`, { txid });
    return res.status(200).json({ message: `Completed the payment ${paymentId}` });
  });

  // handle the cancelled payment
  router.post('/cancelled_payment', async (req, res) => {
    const paymentId = req.body.paymentId;
    await supabase.from('orders').update({ cancelled: true }).eq('pi_payment_id', paymentId);
    return res.status(200).json({ message: `Cancelled the payment ${paymentId}` });
  })
}

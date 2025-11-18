import { useCallback } from 'react';
import type { PaymentDTO } from '@/types/pi-sdk';


export function usePiPayment() {
  const createPayment = useCallback(async ({ amount, memo, metadata }: { amount: number; memo: string; metadata?: Record<string, unknown> }): Promise<PaymentDTO | undefined> => {
  const backendUrl = (import.meta as any).env.VITE_BACKEND_URL as string | undefined;
    if (!backendUrl) throw new Error('Missing VITE_BACKEND_URL');
    const base = backendUrl.replace(/\/$/, '');

    const onReadyForServerApproval = (paymentId: string) => {
      fetch(`${base}/payments/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ paymentId }) });
    };
    const onReadyForServerCompletion = (paymentId: string, txid: string) => {
      fetch(`${base}/payments/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ paymentId, txid }) });
    };
    const onCancel = (paymentId: string) => {
      fetch(`${base}/payments/cancelled_payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ paymentId }) });
    };
    const onError = (error: Error) => { console.error('Pi payment error', error); };

    const payment: PaymentDTO = await window.Pi.createPayment({ amount, memo, metadata: metadata ?? {} }, { onReadyForServerApproval, onReadyForServerCompletion, onCancel, onError });
    return payment;
  }, []);

  return { createPayment };
}

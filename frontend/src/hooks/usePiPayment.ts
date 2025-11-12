import { useCallback } from 'react';

declare global {
  interface Window {
    Pi: any;
  }
}

export function usePiPayment() {
  const createPayment = useCallback(async ({ amount, memo, metadata }: { amount: number; memo: string; metadata?: Record<string, unknown> }) => {
    const onReadyForServerApproval = (paymentId: string) => {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL as string | undefined;
  if (!backend) throw new Error('Missing NEXT_PUBLIC_BACKEND_URL');
  fetch(`${backend.replace(/\/$/, '')}/payments/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paymentId }),
      });
    };

    const onReadyForServerCompletion = (paymentId: string, txid: string) => {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL as string | undefined;
  if (!backend) throw new Error('Missing NEXT_PUBLIC_BACKEND_URL');
  fetch(`${backend.replace(/\/$/, '')}/payments/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paymentId, txid }),
      });
    };

    const onCancel = (paymentId: string) => {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL as string | undefined;
  if (!backend) throw new Error('Missing NEXT_PUBLIC_BACKEND_URL');
  fetch(`${backend.replace(/\/$/, '')}/payments/cancelled_payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paymentId }),
      });
    };

    const onError = (error: Error) => {
      console.error('Pi payment error', error);
    };

    await window.Pi.createPayment({ amount, memo, metadata: metadata ?? {} }, {
      onReadyForServerApproval,
      onReadyForServerCompletion,
      onCancel,
      onError,
    });
  }, []);

  return { createPayment };
}

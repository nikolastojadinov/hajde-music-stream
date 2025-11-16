import { useCallback } from 'react';
import type { PaymentDTO } from '@/types/pi-sdk';


export function usePiPayment() {
  const createPayment = useCallback(async ({ amount, memo, metadata }: { amount: number; memo: string; metadata?: Record<string, unknown> }): Promise<PaymentDTO | undefined> => {
  const backendUrl = (import.meta as any).env.VITE_BACKEND_URL as string | undefined;
    if (!backendUrl) throw new Error('Missing VITE_BACKEND_URL');
    const base = backendUrl.replace(/\/$/, '');

    const onReadyForServerApproval = async (paymentId: string) => {
      console.log('[Payment] Approving payment:', paymentId);
      try {
        const response = await fetch(`${base}/payments/approve`, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          credentials: 'include', 
          body: JSON.stringify({ paymentId }) 
        });
        const result = await response.json();
        console.log('[Payment] Approval result:', result);
      } catch (error) {
        console.error('[Payment] Approval failed:', error);
      }
    };
    
    const onReadyForServerCompletion = async (paymentId: string, txid: string) => {
      console.log('[Payment] Completing payment:', paymentId, txid);
      try {
        const response = await fetch(`${base}/payments/complete`, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          credentials: 'include', 
          body: JSON.stringify({ paymentId, txid }) 
        });
        const result = await response.json();
        console.log('[Payment] Completion result:', result);
      } catch (error) {
        console.error('[Payment] Completion failed:', error);
      }
    };
    
    const onCancel = async (paymentId: string) => {
      console.log('[Payment] Cancelling payment:', paymentId);
      try {
        await fetch(`${base}/payments/cancel`, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          credentials: 'include', 
          body: JSON.stringify({ paymentId }) 
        });
      } catch (error) {
        console.error('[Payment] Cancel failed:', error);
      }
    };
    
    const onError = (error: Error) => { 
      console.error('[Payment] Pi payment error:', error); 
    };

    const payment: PaymentDTO = await window.Pi.createPayment({ amount, memo, metadata: metadata ?? {} }, { onReadyForServerApproval, onReadyForServerCompletion, onCancel, onError });
    return payment;
  }, []);

  return { createPayment };
}

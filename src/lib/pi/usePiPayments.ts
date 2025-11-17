/**
 * Pi Network Payments Hook
 * Handles Pi payment creation and processing
 */

import { useState, useCallback } from 'react';
import type { PaymentDTO } from '@/types/pi-sdk';

interface PaymentMetadata {
  plan?: 'weekly' | 'monthly';
  amount?: number;
  memo?: string;
  [key: string]: unknown;
}

interface CreatePaymentParams {
  amount: number;
  metadata: PaymentMetadata;
}

interface UsePiPaymentsReturn {
  isProcessing: boolean;
  error: string | null;
  createPayment: (params: CreatePaymentParams) => Promise<PaymentDTO | null>;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export function usePiPayments(): UsePiPaymentsReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createPayment = useCallback(async (params: CreatePaymentParams): Promise<PaymentDTO | null> => {
    console.log('[Pi Payments] Creating payment:', params);
    setIsProcessing(true);
    setError(null);

    try {
      // Check if Pi SDK is available
      if (typeof window === 'undefined' || !window.Pi) {
        throw new Error('Pi SDK not available');
      }

      const { amount, metadata } = params;
      const memo = metadata.memo || `Premium subscription - ${metadata.plan || 'weekly'}`;

      console.log('[Pi Payments] Calling Pi.createPayment()...');

      // Create payment with Pi SDK
      const payment = await window.Pi.createPayment(
        {
          amount,
          memo,
          metadata,
        },
        {
          // Called when payment is ready for server approval
          onReadyForServerApproval: async (paymentId: string) => {
            console.log('[Pi Payments] Ready for approval:', paymentId);

            try {
              const response = await fetch(`${BACKEND_URL}/pi/payments/approve`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ paymentId }),
              });

              if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Approval failed');
              }

              const data = await response.json();
              console.log('[Pi Payments] Approval successful:', data);

            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : 'Approval failed';
              console.error('[Pi Payments ERROR] Approval failed:', errorMessage);
              throw err;
            }
          },

          // Called when payment is ready for server completion
          onReadyForServerCompletion: async (paymentId: string, txid: string) => {
            console.log('[Pi Payments] Ready for completion:', { paymentId, txid });

            try {
              const response = await fetch(`${BACKEND_URL}/pi/payments/complete`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ paymentId, txid }),
              });

              if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Completion failed');
              }

              const data = await response.json();
              console.log('[Pi Payments] Completion successful:', data);

            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : 'Completion failed';
              console.error('[Pi Payments ERROR] Completion failed:', errorMessage);
              throw err;
            }
          },

          // Called if payment is cancelled
          onCancel: (paymentId: string) => {
            console.log('[Pi Payments] Payment cancelled:', paymentId);
            setError('Payment cancelled');
            setIsProcessing(false);
          },

          // Called on payment error
          onError: (error: Error, payment?: PaymentDTO) => {
            console.error('[Pi Payments ERROR]', error, payment);
            setError(error.message);
            setIsProcessing(false);
          },
        }
      );

      console.log('[Pi Payments] Payment created:', payment);
      setIsProcessing(false);
      return payment;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Payment creation failed';
      console.error('[Pi Payments ERROR] Create payment failed:', errorMessage);
      setError(errorMessage);
      setIsProcessing(false);
      return null;
    }
  }, []);

  return {
    isProcessing,
    error,
    createPayment,
  };
}

// Compatibility wrapper that uses the centralized PiContext payment flow
import { usePi } from '@/contexts/PiContext';

export function usePiPayment() {
  const { createPayment } = usePi();
  return { createPayment };
}

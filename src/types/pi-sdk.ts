export interface AuthResult {
  accessToken: string;
  user: {
    uid: string;
    username: string;
    roles: string[];
  };
}

export interface PaymentDTO {
  amount: number;
  user_uid: string;
  created_at: string;
  identifier: string;
  metadata: Record<string, unknown>;
  memo: string;
  status: {
    developer_approved: boolean;
    transaction_verified: boolean;
    developer_completed: boolean;
    cancelled: boolean;
    user_cancelled: boolean;
  };
  to_address: string;
  transaction: null | {
    txid: string;
    verified: boolean;
    _link: string;
  };
}

// Augment global Window for Pi SDK
declare global {
  interface Window {
    Pi: {
      init: (opts: { version: string; sandbox: boolean }) => void;
      authenticate: (scopes: string[], onIncompletePaymentFound: (p: PaymentDTO) => Promise<unknown> | unknown) => Promise<AuthResult>;
      createPayment: (
        paymentData: { amount: number; memo: string; metadata?: Record<string, unknown> },
        callbacks: {
          onReadyForServerApproval: (paymentId: string) => void;
          onReadyForServerCompletion: (paymentId: string, txid: string) => void;
          onCancel: (paymentId: string) => void;
          onError: (error: Error, payment?: PaymentDTO) => void;
        }
      ) => Promise<PaymentDTO>;
    };
  }
}

export {};
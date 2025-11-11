import React from 'react';
import { usePiLogin } from '../hooks/usePiLogin';
import { usePiPayment } from '../hooks/usePiPayment';

// Minimal UI to exercise Pi auth + payment flow
export default function PiAuth() {
  const { login, loading, error, user } = usePiLogin();
  const { createPayment } = usePiPayment();

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Pi Auth / Payment Demo</h1>
      {user ? (
        <>
          <p>Signed in as <strong>{user.username}</strong> (uid: {user.uid})</p>
          <button
            onClick={() => createPayment({ amount: 1, memo: 'Test payment', metadata: { type: 'demo' } })}
            style={{ padding: '8px 16px', marginRight: 12 }}
          >
            Create 1π Payment
          </button>
        </>
      ) : (
        <button
          onClick={login}
          disabled={loading}
          style={{ padding: '8px 16px' }}
        >
          {loading ? 'Signing in…' : 'Sign in with Pi'}
        </button>
      )}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
    </div>
  );
}

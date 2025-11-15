import React from 'react';
import { usePi } from '@/contexts/PiContext';

export default function PiAuthDemo() {
  const { user, signIn, createPayment, sdkReady, sdkError } = usePi();
  
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Pi Auth / Payment Demo</h1>
      
      {sdkError && (
        <div className="p-4 bg-destructive/10 border border-destructive rounded">
          <p className="text-destructive">{sdkError}</p>
        </div>
      )}
      
      {user ? (
        <div className="space-y-2">
          <p>Signed in as <strong>{user.username}</strong> (uid: {user.uid})</p>
          <button
            className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50"
            onClick={() => createPayment({ amount: 1, memo: 'Test payment', metadata: { type: 'demo' } })}
            disabled={!sdkReady}
          >Create 1π Payment</button>
        </div>
      ) : (
        <button
          className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50"
          onClick={() => signIn().catch(err => alert(err.message))}
          disabled={!sdkReady}
        >{sdkReady ? 'Sign in with Pi' : 'Pi SDK Loading...'}</button>
      )}
    </div>
  );
}

import React from 'react';
import { usePiLogin } from '../hooks/usePiLogin';
import { usePiPayment } from '../hooks/usePiPayment';
import { useLanguage } from '../contexts/LanguageContext';

export default function PiAuthDemo() {
  const { login, loading, error, user } = usePiLogin();
  const { createPayment } = usePiPayment();
  const { t } = useLanguage();
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Pi Auth / Payment Demo</h1>
      {user ? (
        <div className="space-y-2">
          <p>{t('logged_in_message').replace('{username}', user.username)} (uid: {user.uid})</p>
          <button
            className="px-4 py-2 rounded bg-primary text-primary-foreground"
            onClick={() => createPayment({ amount: 1, memo: 'Test payment', metadata: { type: 'demo' } })}
          >Create 1π Payment</button>
        </div>
      ) : (
        <button
          className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50"
          onClick={login}
          disabled={loading}
        >{loading ? t('signing_in') : t('sign_in_with_pi')}</button>
      )}
      {error && <p className="text-foreground">Error: {error}</p>}
    </div>
  );
}

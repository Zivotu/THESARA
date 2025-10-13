import { Suspense } from 'react';
import BillingSuccessClient from './ClientPage';

export default function Page() {
  return (
    <Suspense>
      <BillingSuccessClient />
    </Suspense>
  );
}


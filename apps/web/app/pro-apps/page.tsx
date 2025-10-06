import { Suspense } from 'react';
import ProAppsClient from './ProAppsClient';

export default function Page() {
  return (
    <Suspense>
      <ProAppsClient />
    </Suspense>
  );
}


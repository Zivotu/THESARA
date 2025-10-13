import { Suspense } from 'react';
import MyPageClient from './MyPageClient';

export default function Page() {
  return (
    <Suspense>
      <MyPageClient />
    </Suspense>
  );
}


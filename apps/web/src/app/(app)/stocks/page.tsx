import { Suspense } from 'react';
import { StocksPage } from '@/features/stocks/stocks-page';

export const metadata = { title: 'Stocks' };

export default function StocksPageRoute() {
  return (
    <Suspense>
      <StocksPage />
    </Suspense>
  );
}

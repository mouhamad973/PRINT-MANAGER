import type { Metadata } from 'next';
import { SystemStatus } from '@/features/system/system-status';

export const metadata: Metadata = { title: 'État de la plateforme' };

export default function HomePage() {
  return <SystemStatus />;
}

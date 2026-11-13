import type { Metadata } from 'next';
import { LegalShell, PrivacySection } from '../legal-page';

export const metadata: Metadata = { title: '隐私说明 · 一元知命' };

export default function PrivacyPage() {
  return (
    <LegalShell>
      <PrivacySection />
    </LegalShell>
  );
}

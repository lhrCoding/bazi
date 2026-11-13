import type { Metadata } from 'next';
import { DisclaimerSection, LegalShell } from '../legal-page';

export const metadata: Metadata = { title: '免责声明 · 一元知命' };

export default function DisclaimerPage() {
  return (
    <LegalShell>
      <DisclaimerSection />
    </LegalShell>
  );
}

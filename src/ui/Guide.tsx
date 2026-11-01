// The guide of the accounts (Fouad, 2026-11-02): see src/guide/content.ts.
import { ACCOUNTS_GUIDE } from '../guide/content';
import { GuideView } from '../guide/GuideView';
import { t } from './kit';

export function Guide({ section }: { section: string | null }) {
  return (
    <>
      <div className="page-head"><h1>📖 {t('الدليل', 'Guide')}</h1></div>
      <GuideView key={section ?? ''} sections={ACCOUNTS_GUIDE} initial={section} />
    </>
  );
}

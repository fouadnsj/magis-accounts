// Writes DOORS-SENTENCES.md: the warm sentences of the doors page, with their source, for Fouad to review. Touches nothing else.
//   build:  node_modules/.bin/esbuild scripts/doors-sentences-md.ts --bundle --platform=node --format=esm --outfile=/tmp/doors-md.mjs
//   run:    node --no-warnings /tmp/doors-md.mjs DOORS-SENTENCES.md
import fs from 'node:fs';
import { SENTENCES, type Sentence } from '../src/ui/doorSentences';

const out = process.argv[2] ?? 'DOORS-SENTENCES.md';
const KIND: Record<Sentence['kind'], string> = {
  charter: 'The MAGIS charter',
  logo: 'The explanation of the centres’ logos',
  note: 'The concept note / the Al-Ard report',
  testimony: 'A testimony (no name shown)',
  app: 'The first page of the program (already approved there)',
  original: 'ORIGINAL (written for this page, same spirit, belongs to nobody)',
  centre: 'Written by the centre (never in the code)',
};
const SLOT: Record<string, string> = { centre: 'the heading', accounts: 'Accounts', calendar: 'Calendar', inventory: 'Inventory', hr: 'HR', admin: 'Administration', tv: 'the TV' };
const lines: string[] = [
  '# The warm sentences of the doors page',
  '',
  'Fouad, these are all the sentences the doors page can show (24 November 2026). A different one is drawn at every visit: one under the',
  'name of the centre, and one on each door. **Rule:** every sentence is traced to a source below, or is marked ORIGINAL. Nothing is an',
  'invented name, number, testimony or quote. A testimony never shows the name of the person. To change, remove or add a sentence, tell me,',
  'or edit `src/ui/doorSentences.ts`.',
  '',
  '**These are the DEFAULTS.** Since 26 November 2026 the sentences are ONE pool for the whole centre (the doors page and the TV): the Administrator and the Director',
  'can switch each one off, edit it, choose where it appears, or write their own in Administration → Sentences. A correction made here reaches a centre that never changed the sentence.',
  '',
  '"Translated" means the source is in another language and the sentence in this language was translated for the page: please read it.',
  '',
  `${SENTENCES.length} sentences.`,
  '',
];
for (const k of Object.keys(KIND) as Sentence['kind'][]) {
  const xs = SENTENCES.filter((s) => s.kind === k);
  if (!xs.length) continue;
  lines.push(`## ${KIND[k]} (${xs.length})`, '');
  for (const s of xs) {
    const where = s.for.map((f) => SLOT[f]).join(', ') + (s.centre ? ` · only with ${s.centre}` : '');
    lines.push(`### ${s.id}`, '', `- Arabic: ${s.msg.ar}`, `- English: ${s.msg.en}`, `- French: ${s.msg.fr ?? ''}`);
    if (s.by) lines.push(`- Said by: ${s.by.en}`);
    lines.push(`- Source: ${s.source}`, `- Shown on: ${where}`);
    if (s.tr?.length) lines.push(`- Translated for the page: ${s.tr.join(', ')}`);
    lines.push('');
  }
}
fs.writeFileSync(out, lines.join('\n'));
console.log(`${SENTENCES.length} sentences written to ${out}`);

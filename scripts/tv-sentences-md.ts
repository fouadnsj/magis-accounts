// Writes TV-SENTENCES.md: the welcome phrases of the TV screen, with their source, for Fouad to review. Touches nothing else.
//   build:  node_modules/.bin/esbuild scripts/tv-sentences-md.ts --bundle --platform=node --format=esm --outfile=/tmp/tv-md.mjs
//   run:    node --no-warnings /tmp/tv-md.mjs TV-SENTENCES.md
import fs from 'node:fs';
import { TV_SENTENCES } from '../src/hosting/tvSentences';
import type { Sentence } from '../src/ui/doorSentences';

const out = process.argv[2] ?? 'TV-SENTENCES.md';
const KIND: Record<Sentence['kind'], string> = {
  charter: 'The MAGIS charter',
  logo: 'The explanation of the centres’ logos',
  note: 'The concept note / the Al-Ard report',
  testimony: 'A testimony (never used on the TV)',
  app: 'The first page of the program (already approved there)',
  original: 'ORIGINAL (written for this screen, same spirit, belongs to nobody)',
  centre: 'Written by the centre',
};
const lines: string[] = [
  '# The welcome phrases of the TV screen',
  '',
  'Fouad, these are all the phrases the TV can show under the name of the centre (26 November 2026). One at a time, a new one every 5 minutes (the Director can change this, and switch phrases off, edit them or write others, in Calendar → Settings → TV phrases),',
  'Arabic first and English (or French) under it; the order changes every day. **Rule:** every phrase is traced to a source below, or is marked',
  'ORIGINAL. Nothing is an invented name, number, testimony or quote. **No testimony is used on the TV** (a screen at the entrance is seen by',
  'everyone). A phrase taken from one centre\'s logo or house is shown only on that centre\'s TV. Most come from the doors page by name',
  '(`src/ui/doorSentences.ts`, which holds the whole default pool: the ones for the TV carry the place "tv").',
  'The list below is the DEFAULT (the code). Since 26 November 2026 the TV and the doors page draw from ONE pool of sentences for the centre (Administration → Sentences:',
  'the Administrator and the Director switch sentences off, edit them, choose where each appears, or write their own; the TV interval and language are set there too). Each centre keeps its own changes in its database, so a correction made here reaches a centre that never edited the phrase.',
  '',
  'Above the phrase, a small greeting by the hour: «صباح الخير · Good morning» (until 12:00), «أهلاً بكم · Welcome» (12:00–17:00), «مساء الخير · Good evening» (after 17:00).',
  '',
  `${TV_SENTENCES.length} phrases.`,
  '',
];
for (const k of Object.keys(KIND) as Sentence['kind'][]) {
  const xs = TV_SENTENCES.filter((s) => s.kind === k);
  if (!xs.length) continue;
  lines.push(`## ${KIND[k]} (${xs.length})`, '');
  for (const s of xs) {
    lines.push(`### ${s.id}`, '', `- Arabic: ${s.msg.ar}`, `- English: ${s.msg.en}`, `- French: ${s.msg.fr ?? ''}`, `- Source: ${s.source}`);
    lines.push(`- Shown on: ${s.centre ? `only the ${s.centre} TV` : 'every TV'}${s.for.length > 1 ? ' · also on the doors page (' + s.for.filter((f) => f !== 'tv').join(', ') + ')' : ''}`);
    if (s.tr?.length) lines.push(`- Translated for the page: ${s.tr.join(', ')} (please read)`);
    lines.push('');
  }
}
fs.writeFileSync(out, lines.join('\n'));
console.log(`${out}: ${TV_SENTENCES.length} phrases`);

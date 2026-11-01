// The guide's screen, the same in the accounts and in HR (Fouad, 2026-11-02): the sections on one side, the chosen
// section on the other; and the 📖 on each page, which opens the guide at that page's section.
import { createContext, useContext, useState } from 'react';
import { m, tx } from '../i18n';
import type { GuideSection } from './content';

/** Opens the guide at a section (given by each program around its pages). */
export const GuideCtx = createContext<(id: string) => void>(() => undefined);

/** The 📖 of a page: opens its section of the guide. */
export function GuideLink({ id }: { id: string }) {
  const open = useContext(GuideCtx);
  return (
    <button type="button" className="btn small ghost" style={{ marginInlineStart: 8, verticalAlign: 'middle' }} title={tx(m('الدليل: كيف تعمل هذه الصفحة', 'Guide: how this page works', 'Guide : comment fonctionne cette page'))} onClick={() => open(id)}>📖</button>
  );
}

export function GuideView({ sections, initial }: { sections: GuideSection[]; initial?: string | null }) {
  const [id, setId] = useState(() => (initial && sections.some((x) => x.id === initial) ? initial : sections[0].id));
  const sec = sections.find((x) => x.id === id) ?? sections[0];
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="panel" style={{ flex: '0 0 230px', padding: 8 }}>
        {sections.map((x) => (
          <button key={x.id} type="button" className={`btn ghost ${x.id === sec.id ? 'primary' : ''}`} style={{ display: 'block', width: '100%', textAlign: 'start', marginBottom: 2 }} onClick={() => setId(x.id)}>
            {x.icon} {tx(x.title)}
          </button>
        ))}
      </div>
      <div className="panel" style={{ flex: '1 1 420px', maxWidth: 820 }}>
        <h2 style={{ marginTop: 0 }}>{sec.icon} {tx(sec.title)}</h2>
        <p className="muted">{tx(sec.intro)}</p>
        <ol style={{ paddingInlineStart: 20 }}>
          {sec.steps.map((st, i) => (
            <li key={i} style={{ marginBottom: 12 }}>
              <b>{tx(st.title)}</b>
              <div style={{ marginTop: 3 }}>{tx(st.text)}</div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

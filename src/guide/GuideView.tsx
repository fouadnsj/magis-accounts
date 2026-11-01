// The guide's screen, the same in the accounts and in HR (Fouad, 2026-11-02): the sections on one side, the chosen
// section on the other; and the "Guide" button on each page (the MAGIS sun), which opens it at that page's section.
import { createContext, useContext, useState } from 'react';
import { m, tx } from '../i18n';
import type { GuideSection } from './content';

/** Opens the guide at a section (given by each program around its pages). */
export const GuideCtx = createContext<(id: string) => void>(() => undefined);

/** The MAGIS sun, the guide's sign (white on the dark side menus). */
export function GuideSun({ size = 18, light = false }: { size?: number; light?: boolean }) {
  return <img src="/brand/magis-sun.png" alt="" style={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'middle', filter: light ? 'brightness(0) invert(1)' : undefined }} />;
}

/** The guide's button on a page: the MAGIS sun and "Guide", in the welcome page's colours; opens its section. */
export function GuideLink({ id }: { id: string }) {
  const open = useContext(GuideCtx);
  return (
    <button type="button" onClick={() => open(id)} title={tx(m('الدليل: كيف تعمل هذه الصفحة', 'Guide: how this page works', 'Guide : comment fonctionne cette page'))}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginInlineStart: 10, verticalAlign: 'middle', padding: '2px 10px 2px 6px', borderRadius: 999,
        border: '1px solid #B8891B', background: '#FBF7EE', color: '#8A6A1A', font: 'inherit', fontSize: 13, fontWeight: 600, lineHeight: '20px', cursor: 'pointer' }}>
      <GuideSun size={20} />{tx(m('الدليل', 'Guide', 'Guide'))}
    </button>
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

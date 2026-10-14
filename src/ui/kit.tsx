// Small building blocks shared by every screen.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { tx, type Msg } from '../i18n';

/** Bilingual text: "عربي · English" (or English only, by setting). */
export function T({ ar, en }: { ar: string; en: string }) {
  return <>{tx({ ar, en })}</>;
}
export const t = (ar: string, en: string) => tx({ ar, en });

// ---------------------------------------------------------------- numbers

/** Pounds: #,##0;(#,##0);-  — zero as a dash, negatives in parentheses. */
export function fmtSyp(n: number | null | undefined): string {
  if (n == null || Math.abs(n) < 0.5) return '-';
  const s = Math.round(Math.abs(n)).toLocaleString('en-US');
  return n < 0 ? `(${s})` : s;
}

/** Dollars: #,##0.00;(#,##0.00);- */
export function fmtUsd(n: number | null | undefined): string {
  if (n == null || Math.abs(n) < 0.005) return '-';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
}

export function fmtRate(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** dd/mm/yyyy from YYYY-MM-DD */
export function fmtDate(d: string | null): string {
  if (!d) return '—';
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/** Reads an amount typed by a person: "1,500", " 1500 ", "١٥٠٠" (Arabic digits). */
export function parseAmount(s: string): number {
  const western = s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,\s٬]/g, '').replace('٫', '.');
  if (western === '') return 0;
  const n = Number(western);
  return Number.isFinite(n) ? n : NaN;
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- controls

export function Field({ label, children, bad, className }: { label: ReactNode; children: ReactNode; bad?: boolean; className?: string }) {
  return (
    <label className={`field ${bad ? 'bad' : ''} ${className ?? ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export interface Option {
  value: number;
  label: string;
  off?: boolean;
}

export function Select({ value, options, onChange, placeholder, disabled }: { value: number | null; options: Option[]; onChange: (v: number | null) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">{placeholder ?? '—'}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
          {o.off ? ' ✕' : ''}
        </option>
      ))}
    </select>
  );
}

/** Searchable select. With onAdd, a name that is not in the list can be added on the spot. */
export function Combo({ value, options, onChange, onAdd, placeholder }: { value: number | null; options: Option[]; onChange: (v: number | null) => void; onAdd?: (name: string) => Promise<number | null>; placeholder?: string }) {
  const current = options.find((o) => o.value === value);
  const [text, setText] = useState(current?.label ?? '');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  useEffect(() => setText(current?.label ?? ''), [current?.label]);
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const base = options.filter((o) => !o.off);
    return q && q !== current?.label.toLowerCase() ? base.filter((o) => o.label.toLowerCase().includes(q)) : base;
  }, [text, options, current]);
  const exact = options.some((o) => o.label.toLowerCase() === text.trim().toLowerCase());
  const pick = (o: Option) => {
    onChange(o.value);
    setText(o.label);
    setOpen(false);
  };
  return (
    <div className="combo">
      <input
        value={text}
        placeholder={placeholder}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onBlur={() => setTimeout(() => {
          setOpen(false);
          if (!text.trim()) onChange(null);
          else setText(current?.label ?? '');
        }, 150)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, matches.length - 1));
          else if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0));
          else if (e.key === 'Enter' && open && matches[hi]) {
            e.preventDefault();
            pick(matches[hi]);
          }
        }}
      />
      {open && (
        <div className="combo-list">
          {matches.slice(0, 200).map((o, i) => (
            <div key={o.value} className={i === hi ? 'hi' : ''} onMouseDown={() => pick(o)}>
              {o.label}
            </div>
          ))}
          {onAdd && text.trim() && !exact && (
            <div
              className="add"
              onMouseDown={async () => {
                const id = await onAdd(text.trim());
                if (id != null) onChange(id);
                setOpen(false);
              }}
            >
              ＋ {t('إضافة', 'Add')} "{text.trim()}"
            </div>
          )}
          {!matches.length && !onAdd && <div className="muted">{t('لا نتائج', 'No match')}</div>}
        </div>
      )}
    </div>
  );
}

export function Seg<V extends string>({ value, options, onChange }: { value: V | null; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button type="button" key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<V extends string>({ value, tabs, onChange }: { value: V; tabs: { value: V; label: string; hidden?: boolean }[]; onChange: (v: V) => void }) {
  return (
    <div className="tabs">
      {tabs.filter((x) => !x.hidden).map((x) => (
        <button key={x.value} className={value === x.value ? 'on' : ''} onClick={() => onChange(x.value)}>
          {x.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, children, onClose, narrow }: { title: ReactNode; children: ReactNode; onClose: () => void; narrow?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${narrow ? 'narrow' : ''}`}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Msgs({ errors, warnings }: { errors?: Msg[]; warnings?: Msg[] }) {
  return (
    <>
      {!!errors?.length && (
        <div className="alert err">
          <b>{t('لا يمكن الحفظ', 'Cannot save')}</b>
          <ul>{errors.map((e, i) => <li key={i}>{tx(e)}</li>)}</ul>
        </div>
      )}
      {!!warnings?.length && (
        <div className="alert warn">
          <b>{t('انتبه', 'Please check')}</b>
          <ul>{warnings.map((e, i) => <li key={i}>{tx(e)}</li>)}</ul>
        </div>
      )}
    </>
  );
}

/** Confirm dialog driven by a promise: `if (await confirm(...))`. */
let confirmImpl: ((msg: string, danger?: boolean) => Promise<boolean>) | null = null;
export const confirmBox = (msg: string, danger = false) => (confirmImpl ? confirmImpl(msg, danger) : Promise.resolve(window.confirm(msg)));

export function ConfirmHost() {
  const [state, setState] = useState<{ msg: string; danger: boolean; resolve: (b: boolean) => void } | null>(null);
  useEffect(() => {
    confirmImpl = (msg, danger = false) => new Promise((resolve) => setState({ msg, danger, resolve }));
    return () => {
      confirmImpl = null;
    };
  }, []);
  if (!state) return null;
  const done = (b: boolean) => {
    state.resolve(b);
    setState(null);
  };
  return (
    <Modal title={t('تأكيد', 'Confirm')} onClose={() => done(false)} narrow>
      <p style={{ whiteSpace: 'pre-wrap' }}>{state.msg}</p>
      <div className="modal-foot">
        <button className="btn" onClick={() => done(false)}>
          {t('إلغاء', 'Cancel')}
        </button>
        <button className={`btn ${state.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => done(true)}>
          {t('نعم', 'Yes')}
        </button>
      </div>
    </Modal>
  );
}

/** Text prompt (window.prompt is not available in every desktop window). */
let promptImpl: ((msg: string, value: string) => Promise<string | null>) | null = null;
export const promptBox = (msg: string, value = '') => (promptImpl ? promptImpl(msg, value) : Promise.resolve(window.prompt(msg, value)));

export function PromptHost() {
  const [state, setState] = useState<{ msg: string; value: string; resolve: (v: string | null) => void } | null>(null);
  useEffect(() => {
    promptImpl = (msg, value) => new Promise((resolve) => setState({ msg, value, resolve }));
    return () => {
      promptImpl = null;
    };
  }, []);
  if (!state) return null;
  const done = (v: string | null) => {
    state.resolve(v);
    setState(null);
  };
  return (
    <Modal title={state.msg} onClose={() => done(null)} narrow>
      <form onSubmit={(e) => { e.preventDefault(); done(state.value); }}>
        <input className="inp" autoFocus value={state.value} onChange={(e) => setState({ ...state, value: e.target.value })} />
        <div className="modal-foot">
          <button type="button" className="btn" onClick={() => done(null)}>{t('إلغاء', 'Cancel')}</button>
          <button className="btn primary">{t('موافق', 'OK')}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Toasts */
let toastImpl: ((msg: string, err?: boolean) => void) | null = null;
export const toast = (msg: string, err = false) => toastImpl?.(msg, err);

export function ToastHost() {
  const [m, setM] = useState<{ msg: string; err: boolean } | null>(null);
  const timer = useRef<number>();
  useEffect(() => {
    toastImpl = (msg, err = false) => {
      setM({ msg, err });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setM(null), err ? 7000 : 3500);
    };
    return () => {
      toastImpl = null;
    };
  }, []);
  return m ? <div className={`toast ${m.err ? 'err' : ''}`} onClick={() => setM(null)}>{m.msg}</div> : null;
}

/** Message of any error, bilingual when it is a UserError. */
export function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'msg' in e) return tx((e as { msg: Msg }).msg);
  if (e instanceof Error) return e.message;
  return String(e);
}

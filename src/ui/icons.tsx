// Small line icons used on the sign-in page and on Home (stroke follows the text colour).
export const ICON: Record<'superior' | 'accountant' | 'holder' | 'person' | 'office', string> = {
  superior: 'M12 2v4M10 4h4M6 22V10l6-4 6 4v12M3 22h18M10 22v-5a2 2 0 0 1 4 0v5',
  accountant: 'M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01',
  holder: 'M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M21 8h-5a3 3 0 0 0 0 6h5V8zM16 11h.01',
  office: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 10h.01M15 10h.01M9 14h.01M15 14h.01',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
};
export function PersonIcon({ kind }: { kind: keyof typeof ICON }) {
  return (
    <span className={`person-icon pi-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[kind]} /></svg>
    </span>
  );
}


// The phone page (/phone.html): a small page of its own, kept by the phone so that it opens with no connection.
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './phone.css';

createRoot(document.getElementById('root')!).render(<App />);

// the page and its files are kept on the phone (public/phone-sw.js); only this page, never the rest of the program
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/phone-sw.js', { scope: '/phone.html' }).catch(() => undefined); });
}
// ask the phone not to clear what is kept here when it runs short of room
void navigator.storage?.persist?.().catch(() => undefined);

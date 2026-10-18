// A page that meets an error says so (with the error) instead of going blank, so the
// person can go on with another page and tell what happened.
import { Component, type ReactNode } from 'react';
import { t3 } from './text';

export class PageGuard extends Component<{ children: ReactNode; page?: string }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidUpdate(prev: { page?: string }) {
    // another page chosen: try again
    if (prev.page !== this.props.page && this.state.err) this.setState({ err: null });
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="alert err" style={{ margin: 12 }}>
        <b>{t3('هذه الصفحة واجهت خطأ.', 'This page met an error.', 'Cette page a rencontré une erreur.')}</b>
        <div className="small" style={{ margin: '6px 0' }}>{this.state.err.message}</div>
        <button className="btn" onClick={() => this.setState({ err: null })}>{t3('حاول مجدداً', 'Try again', 'Réessayer')}</button>
      </div>
    );
  }
}

/** The screens are newer than the server (a test server started before an update). */
export function ServerTooOld({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="cty"><div className="cty-page">
      <div className="alert warn">
        <b>{t3('الخادم أقدم من هذه الشاشات.', 'The server is older than these screens.', 'Le serveur est plus ancien que ces écrans.')}</b>
        <p>{t3('أغلق نافذة خادم التجربة ثم افتحه من جديد (tester-communautes.command).', 'Close the test server window, then start it again (tester-communautes.command).', 'Fermez la fenêtre du serveur de test, puis relancez-le (tester-communautes.command).')}</p>
      </div>
      <button className="btn" onClick={onLogout}>{t3('خروج', 'Sign out', 'Sortir')}</button>
    </div></div>
  );
}

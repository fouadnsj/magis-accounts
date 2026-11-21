// Picking a database file: a plain one (.db), or a protected copy (.magisbak) that is opened here, with the copy
// password, before anything is sent (Fouad, 21 November 2026). The password never leaves this window.
import { pickFile, type Picked } from '../platform';
import { promptBox, toast } from '../ui/kit';
import { m, tx } from '../i18n';
import { isProtected, unprotect, WrongPassword } from './protect';

const t3 = (ar: string, en: string, fr: string) => tx(m(ar, en, fr));

/** Picks a database file; a protected copy is opened with the password (asked up to three times). null: cancelled. */
export async function pickDatabaseFile(title: string): Promise<Picked | null> {
  const f = await pickFile(['db', 'magisbak'], title);
  if (!f || !isProtected(f.bytes)) return f;
  for (let i = 0; i < 3; i++) {
    const pw = await promptBox(t3('هذه نسخة محمية: اكتب كلمة سر النسخ', 'This is a protected copy: write the copy password', 'Ceci est une copie protégée : écrivez le mot de passe des copies'), '', true);
    if (!pw) return null;
    try {
      return { ...f, name: f.name.replace(/\.magisbak$/i, ''), bytes: await unprotect(f.bytes, pw) };
    } catch (e) {
      if (!(e instanceof WrongPassword)) throw e;
      toast(t3('كلمة السر غير صحيحة', 'Wrong password', 'Mot de passe incorrect'), true);
    }
  }
  return null;
}

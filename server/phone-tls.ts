// The phones' certificate (Fouad, 2026-11-13).
//
// An iPhone keeps a web page for use with no connection only when it trusts the server's certificate, and it trusts a
// certificate made by the server itself only through a small "authority" installed on the phone once. So the server makes:
//   - "MAGIS phones": the authority, made once, kept for 10 years. Its key never leaves the server's folder. It is limited
//     ("name constraints") to addresses inside a local network: a phone that trusts it trusts no web site because of it.
//   - the certificate of the phones' address (port 8444), signed by it, for the server's local addresses. It lasts 800 days
//     (Apple refuses longer ones) and is made again, under the same authority, when an address changes or the end comes near:
//     the phones see no change.
// The computers keep the server's first certificate (port 8443): the desktop app remembers that one, and nothing changes for it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { webcrypto, createHash } from 'node:crypto';
import * as x509 from '@peculiar/x509';

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 } as const;
const DAY = 86_400_000;
const LEAF_DAYS = 800;

/** the local networks the authority may speak for: 10/8, 172.16/12, 192.168/16, 100.64/10 (shared), 127/8 */
const NETS: [number[], number[]][] = [
  [[10, 0, 0, 0], [255, 0, 0, 0]],
  [[172, 16, 0, 0], [255, 240, 0, 0]],
  [[192, 168, 0, 0], [255, 255, 0, 0]],
  [[100, 64, 0, 0], [255, 192, 0, 0]],
  [[127, 0, 0, 0], [255, 0, 0, 0]],
];
export const isLocalIp = (ip: string) => {
  const p = ip.split('.').map(Number);
  return p.length === 4 && p.every((n) => n >= 0 && n <= 255) && NETS.some(([a, m]) => p.every((n, i) => (n & m[i]) === a[i]));
};

// DER, written by hand: NameConstraints ::= SEQUENCE { permittedSubtrees [0] SEQUENCE OF SEQUENCE { GeneralName } }
const der = (tag: number, body: Uint8Array) => {
  const n = body.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255];
  return Uint8Array.from([tag, ...len, ...body]);
};
const cat = (...xs: Uint8Array[]) => Uint8Array.from(xs.flatMap((x) => [...x]));
function nameConstraints(): ArrayBuffer {
  const subtrees = [
    ...NETS.map(([a, m]) => der(0x30, der(0x87, Uint8Array.from([...a, ...m])))), // iPAddress [7]
    der(0x30, der(0x82, new TextEncoder().encode('localhost'))), // dNSName [2]: no web site's name
  ];
  return der(0x30, der(0xa0, cat(...subtrees))).slice().buffer;
}

const pem = (label: string, buf: ArrayBuffer) => `-----BEGIN ${label}-----\n${Buffer.from(buf).toString('base64').replace(/.{64}/g, '$&\n').replace(/\n?$/, '\n')}-----END ${label}-----\n`;
const unpem = (s: string) => Buffer.from(s.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
const serial = () => Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString('hex').replace(/^[89a-f]/, '1');

async function importKey(file: string) {
  return webcrypto.subtle.importKey('pkcs8', unpem(fs.readFileSync(file, 'utf8')), ALG, true, ['sign']);
}

export interface PhoneTls {
  key: string;
  /** the address's certificate, then the authority's */
  cert: string;
  /** the authority, as the phone downloads it */
  caDer: Buffer;
  /** SHA-256 of the authority, in groups: what the start page and Admin show, to compare */
  fingerprint: string;
  /** made again just now */
  renewed: boolean;
}

/** The authority (made once) and the address's certificate (made again when needed). */
export async function phoneTls(dataDir: string, addresses: string[]): Promise<PhoneTls> {
  const dir = path.join(dataDir, 'tls');
  fs.mkdirSync(dir, { recursive: true });
  const f = (n: string) => path.join(dir, n);

  // ---- the authority
  if (!fs.existsSync(f('phones-ca.pem')) || !fs.existsSync(f('phones-ca-key.pem'))) {
    const keys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
    const now = Date.now();
    const ca = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: serial(),
      name: `CN=MAGIS phones ${os.hostname().replace(/[,=+<>#;"\\]/g, ' ')}, O=MAGIS`,
      notBefore: new Date(now - DAY),
      notAfter: new Date(now + 3650 * DAY),
      signingAlgorithm: ALG,
      keys,
      extensions: [
        new x509.BasicConstraintsExtension(true, 0, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
        new x509.Extension('2.5.29.30', true, nameConstraints()),
        await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      ],
    });
    fs.writeFileSync(f('phones-ca-key.pem'), pem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)), { mode: 0o600 });
    fs.writeFileSync(f('phones-ca.pem'), ca.toString('pem') + '\n');
    try { fs.unlinkSync(f('phones-covers.json')); } catch { /* none */ }
  }
  const caPem = fs.readFileSync(f('phones-ca.pem'), 'utf8');
  const ca = new x509.X509Certificate(caPem);
  const caDer = Buffer.from(ca.rawData);
  const fingerprint = createHash('sha256').update(caDer).digest('hex').toUpperCase().match(/.{4}/g)!.join(' ');

  // ---- the address's certificate
  const ips = [...new Set(['127.0.0.1', ...addresses.filter(isLocalIp)])];
  try {
    const covers = JSON.parse(fs.readFileSync(f('phones-covers.json'), 'utf8')) as { ips: string[]; until: string; ca: string };
    if (covers.ca === fingerprint && ips.every((ip) => covers.ips.includes(ip)) && Date.parse(covers.until) > Date.now() + 30 * DAY)
      return { key: fs.readFileSync(f('phones-key.pem'), 'utf8'), cert: fs.readFileSync(f('phones-cert.pem'), 'utf8'), caDer, fingerprint, renewed: false };
  } catch { /* none yet */ }

  const caKey = await importKey(f('phones-ca-key.pem'));
  const keys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const now = Date.now();
  const until = new Date(now + LEAF_DAYS * DAY);
  const leaf = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: 'CN=MAGIS phone address, O=MAGIS',
    issuer: ca.subject,
    notBefore: new Date(now - DAY),
    notAfter: until,
    signingAlgorithm: ALG,
    publicKey: keys.publicKey,
    signingKey: caKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: 'localhost' }, ...ips.map((ip) => ({ type: 'ip' as const, value: ip }))]),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(ca),
    ],
  });
  const key = pem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
  const cert = leaf.toString('pem') + '\n' + caPem;
  fs.writeFileSync(f('phones-key.pem'), key, { mode: 0o600 });
  fs.writeFileSync(f('phones-cert.pem'), cert);
  fs.writeFileSync(f('phones-covers.json'), JSON.stringify({ ips, until: until.toISOString(), ca: fingerprint }));
  return { key, cert, caDer, fingerprint, renewed: true };
}

// ---------------------------------------------------------------- the start page: http://<server>:8080/phone
// Plain http on purpose: the phone does not trust the server yet. It gives the authority and the steps, nothing else.

type L = 'ar' | 'en' | 'fr';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function startPage(o: { lang: string | null; acceptLanguage: string; host: string; phonePort: number | null; fingerprint: string | null }): string {
  const l: L = o.lang === 'en' || o.lang === 'fr' || o.lang === 'ar' ? o.lang : /^\s*fr/i.test(o.acceptLanguage) ? 'fr' : /^\s*en/i.test(o.acceptLanguage) ? 'en' : 'ar';
  const t = (ar: string, en: string, fr: string) => (l === 'ar' ? ar : l === 'fr' ? fr : en);
  const app = o.phonePort ? `https://${o.host}:${o.phonePort}/phone.html` : null;
  const langs = (['ar', 'en', 'fr'] as L[]).map((x) => `<a href="/phone?l=${x}"${x === l ? ' class="on"' : ''}>${x === 'ar' ? 'عربي' : x === 'en' ? 'English' : 'Français'}</a>`).join('');
  const body = !app || !o.fingerprint
    ? `<p class="box">${t('الهاتف غير مفعّل على هذا الخادم.', 'Phones are not switched on for this server.', 'Les téléphones ne sont pas activés sur ce serveur.')}</p>`
    : `
<p>${t('مرة واحدة، في المركز، على شبكة الواي فاي الخاصة به.', "Once, at the centre, on its Wi-Fi.", 'Une fois, au centre, sur son Wi-Fi.')}</p>

<h2>1 · ${t('الشهادة', 'The certificate', 'Le certificat')}</h2>
<p>${t('تجعل الهاتف يثق بخادم المركز. لا تصلح لأي موقع آخر.', "It lets the phone trust the centre's server. It is good for no other site.", "Elle permet au téléphone de faire confiance au serveur du centre. Elle ne vaut pour aucun autre site.")}</p>
<p><a class="btn" href="/magis-phones.cer">${t('تنزيل الشهادة', 'Download the certificate', 'Télécharger le certificat')}</a></p>
<div class="box">
<b>iPhone</b>
<ol>
<li>${t('اضغط الزر، ثم «سماح»، ثم «إغلاق».', 'Tap the button, then <i>Allow</i>, then <i>Close</i>.', 'Touchez le bouton, puis <i>Autoriser</i>, puis <i>Fermer</i>.')}</li>
<li>${t('افتح «الإعدادات»: في الأعلى «تم تنزيل ملف التعريف» ← «تثبيت» (رمز الهاتف) ← «تثبيت» ← «تم».', 'Open <i>Settings</i>: at the top, <i>Profile Downloaded</i> → <i>Install</i> (your phone\'s passcode) → <i>Install</i> → <i>Done</i>.', 'Ouvrez <i>Réglages</i> : en haut, <i>Profil téléchargé</i> → <i>Installer</i> (le code du téléphone) → <i>Installer</i> → <i>OK</i>.')}</li>
<li>${t('ثم: «الإعدادات» ← «عام» ← «حول» ← «إعدادات الثقة بالشهادات» (في الأسفل) ← فعّل «MAGIS phones».', 'Then: <i>Settings</i> → <i>General</i> → <i>About</i> → <i>Certificate Trust Settings</i> (at the bottom) → switch on <i>MAGIS phones</i>.', 'Puis : <i>Réglages</i> → <i>Général</i> → <i>Informations</i> → <i>Réglages des certificats</i> (tout en bas) → activez <i>MAGIS phones</i>.')}</li>
</ol>
<b>Android</b>
<ol>
<li>${t('اضغط الزر. إن سأل الهاتف، أعطِ الشهادة اسماً (MAGIS) واختر «VPN والتطبيقات» أو «شهادة CA».', 'Tap the button. If the phone asks, give it a name (MAGIS) and choose <i>VPN and apps</i> or <i>CA certificate</i>.', 'Touchez le bouton. Si le téléphone demande, donnez-lui un nom (MAGIS) et choisissez <i>VPN et applications</i> ou <i>Certificat CA</i>.')}</li>
<li>${t('وإلا: «الإعدادات» ← «الأمان» ← «التشفير وبيانات الاعتماد» ← «تثبيت شهادة» ← «شهادة CA» ← اختر الملف الذي نُزّل. (تختلف الأسماء قليلاً من هاتف لآخر.)', 'Otherwise: <i>Settings</i> → <i>Security</i> → <i>Encryption &amp; credentials</i> → <i>Install a certificate</i> → <i>CA certificate</i> → choose the downloaded file. (The names change a little from phone to phone.)', 'Sinon : <i>Paramètres</i> → <i>Sécurité</i> → <i>Chiffrement et identifiants</i> → <i>Installer un certificat</i> → <i>Certificat CA</i> → choisissez le fichier téléchargé. (Les noms changent un peu selon le téléphone.)')}</li>
</ol>
</div>
<p class="small">${t('رقم الشهادة (للمقارنة بما يظهر على الحاسوب، الإدارة ← المستخدمون ← الهواتف):', 'The certificate\'s number (to compare with the computer, Admin → Users → Phones):', 'Le numéro du certificat (à comparer avec l\'ordinateur, Administration → Utilisateurs → Téléphones) :')}<br><code>${esc(o.fingerprint)}</code></p>

<h2>2 · ${t('التطبيق على الشاشة الرئيسية', 'The app on the home screen', "L'application sur l'écran d'accueil")}</h2>
<p><a class="btn" href="${esc(app)}">${t('افتح MAGIS', 'Open MAGIS', 'Ouvrir MAGIS')}</a><br><code>${esc(app)}</code></p>
<div class="box">
<b>iPhone</b> — ${t('في Safari: زر المشاركة ⬆ ثم «إضافة إلى الشاشة الرئيسية».', 'In Safari: the Share button ⬆, then <i>Add to Home Screen</i>.', 'Dans Safari : le bouton Partager ⬆, puis <i>Sur l\'écran d\'accueil</i>.')}<br>
<b>Android</b> — ${t('في Chrome: القائمة ⋮ ثم «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق».', 'In Chrome: the menu ⋮, then <i>Add to Home screen</i> or <i>Install app</i>.', 'Dans Chrome : le menu ⋮, puis <i>Ajouter à l\'écran d\'accueil</i> ou <i>Installer l\'application</i>.')}
</div>

<h2>3 · ${t('اربط الهاتف', 'Link the phone', 'Relier le téléphone')}</h2>
<p>${t('افتح MAGIS من أيقونته على الشاشة الرئيسية، واربطه هناك: اسمك وكلمة السر، ثم رمز للهاتف.', 'Open MAGIS from its icon on the home screen and link it there: your name and password, then a code for the phone.', "Ouvrez MAGIS par son icône sur l'écran d'accueil et reliez-le là : votre nom et mot de passe, puis un code pour le téléphone.")}</p>
<p class="small">${t('على الآيفون: اربطه من الأيقونة، لا من Safari؛ فهما لا يتشاركان ما يحفظانه.', 'On an iPhone: link it from the icon, not from Safari; the two do not share what they keep.', "Sur iPhone : reliez-le depuis l'icône, pas depuis Safari ; les deux ne partagent pas ce qu'ils gardent.")}</p>`;
  return `<!doctype html>
<html lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MAGIS · ${t('الهاتف', 'Phone', 'Téléphone')}</title>
<style>
body{margin:0;background:#fbf8f1;color:#23263a;font:16px/1.5 -apple-system,system-ui,"Segoe UI",Tahoma,sans-serif}
main{max-width:560px;margin:0 auto;padding:16px 16px 40px}
header{display:flex;align-items:center;gap:12px}header img{width:56px;height:56px}h1{font-size:22px;margin:0}
h2{font-size:18px;margin:26px 0 6px;color:#7a1414}
.langs{display:flex;gap:8px;margin:12px 0}.langs a{padding:4px 10px;border:1px solid #d8cfbd;border-radius:14px;color:#23263a;text-decoration:none;font-size:14px}.langs a.on{background:#23263a;color:#fff}
.btn{display:inline-block;background:#b8862b;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600}
.box{background:#fff;border:1px solid #e4dccb;border-radius:12px;padding:12px 14px}ol{margin:4px 0 10px;padding-inline-start:22px}li{margin:4px 0}
code{direction:ltr;unicode-bidi:embed;word-break:break-all;font-size:13px}.small{font-size:14px;color:#5b5e70}
</style></head><body><main>
<header><img src="/brand/phone-180.png" alt=""><h1>${t('MAGIS على هاتفك', 'MAGIS on your phone', 'MAGIS sur votre téléphone')}</h1></header>
<nav class="langs">${langs}</nav>
${body}
</main></body></html>`;
}

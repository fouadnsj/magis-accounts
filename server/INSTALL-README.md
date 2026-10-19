# MAGIS Accounts 0.7.0 (centres and Jesuit communities): what to install where · ماذا يُثبَّت وأين

| File | Where | What for |
|---|---|---|
| **MAGIS-Server_0.7.0_setup.exe** | **The server PC** (Windows 10/11, 64-bit) | Keeps the databases. Everyone else uses a **browser** (computer or phone) on the centre's network. |
| **MAGIS.Accounts_0.7.0_x64-setup.exe** | Any Windows PC | The desktop app: opens on the **centre's server**, or works alone on a file of that PC. |
| **MAGIS Accounts_0.7.0_aarch64.dmg** | Mac with Apple chip (M1 and later) | The same desktop app, for Mac. |

**With the server, computers and phones can simply use a browser.** The desktop app can also open on the server: first screen → **The centre's server** → type the address (e.g. `192.168.1.20`). It remembers it and opens there each time. It can still work alone on a file (travel, tests).

---

## 1. The server PC
1. Copy **MAGIS-Server_0.7.0_setup.exe** to the PC and double-click it. Answer **Yes**. If Windows warns, click **More info → Run anyway**.
2. At the end, a browser opens on `https://localhost:8443`. At the certificate warning, click **Advanced → Continue**.
3. The welcome page shows the databases, as cards. **＋ New database**: name, centre (or your own logo and colour), then:
   - **From the desktop program's file**: on the Mac, Admin → Backups → **Back up now**, then choose that file. Accounts, lists and users come across as they are.
   - or **A new database** (from the Excel workbook, or empty).
4. **Admin → Server** shows the address to type on the other devices (e.g. `https://192.168.1.20:8443`). Have the router **reserve** that address for this PC.
5. On the PC: **never sleep** when plugged in; **plug a USB key** in and set it in Admin → Server → "Second copy in".
6. **Admin → Users → "Create accounts for all book keepers"**, then hand out the temporary passwords.

The full guide is in **SERVER-INSTRUCTIONS.md**.

**Updating the server (a new version):**
1. On the server PC, open `https://localhost:8443`, sign in as the Superior, **Admin → Backups → Back up now**.
2. Copy the new `MAGIS-Server_…_setup.exe` to the server PC (USB key) and double-click it. Answer **Yes**; if Windows warns: **More info → Run anyway**. It stops the old server, replaces the program and starts the new one. The data in `C:\ProgramData\MAGIS` is kept.
3. A browser opens on `https://localhost:8443`: sign in and check the version in **Admin → Server** (bottom of the first box).
4. The new version takes its own copy of each database before changing it (in its `backups` folder, named `…_before-update-…`).
5. On the other computers and phones: nothing to install. Close the page and open it again (or press F5).

**New in 0.7.0:**
- **One program, two kinds of database.** The first page asks: **MAGIS centres** or **Jesuit communities**. Then: open one, or create one.
- **Jesuit communities** (and the country econome): every Jesuit has his own account; the offices (Superior, Econome, Minister, Administrator) have theirs. A new community is made in three steps: its name, address, city, country and money · its colours (one colour or a set) · its people and offices. See **USER-GUIDE.md**.
- **MAGIS centres:**
  - a light **phone window** for the book holders and the accountant (it opens by itself on a phone; the computer window is unchanged);
  - the four buttons on Home: **Expense · Income · Transfer · Exchange**;
  - an **icon** for each budget heading and line (entry form, register, budget, reports);
  - the **Accountant can reset a forgotten password** (not the Superior's: only who manages users resets another who manages users);
  - **Admin → Roles and permissions**: one table, a column per profile, a tick per right;
  - **one total in dollars** on each book card, and **Reports → Quarters & categories** (SYP, $, or All ≈ $; beside the year before);
  - every screen in **French** too: choose the language at the bottom of the menu (Arabic · English, English, Français, العربية).
- The program takes its own copy of each database before changing it (as before).

## 2. A Windows PC (desktop app)
Double-click **MAGIS.Accounts_0.7.0_x64-setup.exe** → **Install**. If Windows warns: **More info → Run anyway**.
Then: **The centre's server** → the address shown on the server in Admin → Server.

## 3. A Mac (desktop app)
1. Open **MAGIS Accounts_0.7.0_aarch64.dmg** and drag **MAGIS Accounts** into **Applications**.
2. The first time: **right-click** the app → **Open** → **Open**. The app isn't signed with a paid Apple certificate.
3. If macOS still says the app "is damaged", open Terminal and type this line once:
   `xattr -cr "/Applications/MAGIS Accounts.app"`
4. Then: **The centre's server** → the server's address.

**A new database** from a computer other than the server: sign in as the Superior to any database, then in the menu **Databases · new**.

---

## بالعربية
- **ملف الخادم** `MAGIS-Server_0.7.0_setup.exe`: على حاسوب الخادم فقط (ويندوز 10 أو 11). بعده يفتح الجميع البرنامج من **المتصفح** على شبكة المركز، دون تثبيت أي شيء.
- **برنامج ويندوز** `MAGIS.Accounts_0.7.0_x64-setup.exe` و**برنامج ماك** `….dmg`: يفتحان على **خادم المركز** (الشاشة الأولى ← خادم المركز ← العنوان)، أو يعملان وحدهما على ملف.
- على الخادم: ثبّت، افتح `https://localhost:8443`، أنشئ قاعدة البيانات من ملف البرنامج المكتبي، ثبّت عنوان الحاسوب في الراوتر، وصِل مفتاح USB للنسخ الاحتياطية، ثم أنشئ حسابات الأمناء.
- التحديث: ثبّت الملف الجديد فوق القديم. البيانات لا تُمسّ.
- **جديد في 0.7.0:** برنامج واحد لنوعين: **مراكز ماجيس** و**جماعات اليسوعيين**. للمراكز: نافذة للهاتف، أربعة أزرار (نفقة، إيراد، تحويل، تصريف)، أيقونة لكل بند وخط، المحاسب يعيد كلمة السر المنسية، جدول الأدوار والصلاحيات، مجموع واحد بالدولار، «الفصول والبنود»، والفرنسية. انظر **USER-GUIDE.md**.

## En français
- **Serveur** `MAGIS-Server_0.7.0_setup.exe` : sur l'ordinateur serveur seulement (Windows 10 ou 11). Ensuite chacun ouvre le programme depuis un **navigateur** sur le réseau du centre, sans rien installer.
- **Programme Windows** `MAGIS.Accounts_0.7.0_x64-setup.exe` et **programme Mac** `….dmg` : ils s'ouvrent sur le **serveur du centre** (premier écran → serveur du centre → l'adresse), ou travaillent seuls sur un fichier.
- **Mise à jour :** installer le nouveau fichier par-dessus l'ancien. Les données ne sont pas touchées ; une copie de chaque base est faite avant tout changement.
- **Nouveau en 0.7.0 :** un seul programme pour les **centres MAGIS** et les **communautés jésuites** ; pour les centres : une fenêtre téléphone, quatre boutons, une icône par rubrique et ligne, le comptable réinitialise un mot de passe oublié, le tableau des rôles, un total en dollars, « Trimestres et rubriques », et le français. Voir **USER-GUIDE.md**.

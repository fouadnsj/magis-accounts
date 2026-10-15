# The centre's server (mini-PC) · خادم المركز

One small computer in the centre keeps the accounts. Everyone else (computers and phones on the centre's network) opens the program in a **browser**. Nothing needs installing on their devices.

---

## 1. What to buy (for each centre)
- **A mini-PC**: Intel N100/N150, 8–16 GB RAM, 256–512 GB SSD, **Windows 11**.
- **A small UPS** (backup battery), 600–850 VA. Plug both the mini-PC and the Wi-Fi router into it.
- **A USB key or small external disk** for a second copy of the backups. Leave it plugged in.

## 2. Install the server (once)
1. On the mini-PC, download **`MAGIS-Server_…_setup.exe`** from the Releases page of the repository (`fouadnsj/magis-accounts`), or copy it from a USB key.
2. Double-click it. Answer **Yes** to "allow changes", and click **More info → Run anyway** if Windows warns.
3. At the end, a browser opens on `https://localhost:8443`. The first time it says "Your connection is not private": click **Advanced → Continue to localhost**.
   This warning is normal: the server makes its own certificate, so the connection is encrypted, but the browser doesn't know the certificate yet.

From then on, the server **starts by itself** every time the mini-PC is switched on, even before anyone logs in to Windows.

## 3. Databases (on the welcome page)
The welcome page shows **one card per database**, in its centre's colour (Jaramana gold, Aleppo navy, Homs maroon). **"＋ New database"** creates another: a centre, a test, a new year. Choose its name and centre, then how it starts (below). Each database has its own users, backups and numbering. Creating one is possible on the server computer itself, or for someone who manages users.

## 3b. Bring your data in (once per database)
The setup page offers two choices:
- **Move the current office database** (recommended). Your accounts, lists and users come across exactly as they are.
  1. On your Mac, in the desktop app: **Admin → Backups → Back up now**.
  2. Copy the newest file from the `backups` folder (next to your `.db` file) to the mini-PC with a USB key.
  3. On the setup page, choose that file.
  4. **From then on, stop entering anything in the desktop app on the Mac.** Otherwise there would be two different copies of the accounts.
- **A new database**: from the Excel workbook, or empty.

At the first login over the network, anyone who still has an old 4-digit PIN is asked to choose a **password of at least 6 characters**.

## 4. Fix the server's address (once)
1. In the program: **Admin → Server**. It shows the address to type, for example `https://192.168.1.20:8443`.
2. Ask whoever manages the Wi-Fi router to **reserve** that address for the mini-PC (it's called "DHCP reservation"). Otherwise the address can change after a power cut.

## 5. Open the program on a computer or phone
1. Connect to the centre's Wi-Fi.
2. Type the address in the browser, e.g. `https://192.168.1.20:8443`.
3. The first time on each device, there's a certificate warning:
   - **Chrome / Edge / Android**: **Advanced → Continue to … (unsafe)**.
   - **iPhone (Safari)**: **Show Details → visit this website → Visit Website**.
4. Choose your name and type your password.
5. On a phone, use the browser menu → **Add to Home screen**. It then opens like an app.

## 6. Users and permission profiles
- **Admin → Permission profiles**: each profile is a set of ticks grouped by category (Book, Register, Reports, Lists, Admin). Three are ready: **Superior**, **Accountant**, **Book holder**. Change them or create others.
- **Admin → Users**: each person gets one profile and the book(s) they keep (Roula → Roula's book…).
- **"Create accounts for all book keepers"** makes, in one click, an account for every book nobody keeps yet (the keeper's name, his book, a temporary password shown once). First tick in your own account the book you keep yourself.
- A password given by the Superior is temporary: at first login, each person chooses his own.
- A book holder sees and writes only their own book(s), and their reports cover only those books.

## 6b. Transfers and month closing
- **The giver records a transfer, once.** It appears at once in the receiver's book as "⏳ to confirm". The receiver clicks **✓ Received**, or **✗ Not received** with a note.
- **Closing a month has two steps:**
  1. Each holder closes their book's month after counting their cash. This is refused while a transfer is unanswered or a row needs review.
  2. The office closes the whole month. After that nobody can change it. **Only the Superior can reopen.**

## 7. Backups
- Every day, by itself, for every database, in `C:\ProgramData\MAGIS\dbs\<database>\backups`. The last 60 days are kept.
- **A second copy on the USB key**: Admin → Server → "Second copy in", e.g. `E:\MAGIS-backups`. A ✓ shows when the key is found.
- Before every import or restore, a copy is taken first.

## 8. Updates
Download the new `MAGIS-Server_…_setup.exe` and install it over the old one. The data is not touched. The phones and computers don't need anything; they just reload the page.

## 9. If the server is off
Nobody can enter anything until it's on again. With the UPS, short power cuts don't matter. For a long cut: wait, then switch the mini-PC back on, and the server restarts by itself.

## 10. Safety
- The connection is **encrypted** (https), and passwords are stored hashed.
- After 8 wrong passwords, that device is blocked for 5 minutes.
- If visitors use the same Wi-Fi, it's still protected. A separate Wi-Fi for staff is better still.
- Never give your password to anyone. A holder who leaves: Admin → Users → ✕.

---

## العربية — باختصار

1. **الشراء:** حاسوب صغير (mini-PC) بنظام Windows 11، وبطارية احتياطية (UPS) للحاسوب والراوتر، ومفتاح USB للنسخ.
2. **التثبيت:** انقر مرتين على `MAGIS-Server_…_setup.exe`. في النهاية يُفتح المتصفح على `https://localhost:8443`. عند تحذير الشهادة: «متقدم» ثم «متابعة». هذا طبيعي، فالاتصال مشفّر.
3. **نقل البيانات:** على الماك: الإدارة ← النسخ الاحتياطية ← «نسخة الآن». انسخ أحدث ملف إلى الحاسوب الصغير واختره في صفحة الإعداد. **بعدها لا تكتب شيئاً في البرنامج المكتبي على الماك.**
4. **العنوان:** الإدارة ← الخادم يُظهر العنوان (مثلاً `https://192.168.1.20:8443`). اطلب تثبيته في الراوتر.
5. **على الهاتف أو الحاسوب:** اتصل بشبكة المركز واكتب العنوان. عند التحذير في أول مرة: «متقدم ← متابعة». اختر اسمك واكتب كلمة السر. على الهاتف: «إضافة إلى الشاشة الرئيسية».
6. **المستخدمون:** الرئيس يضيف كل أمين صندوق مع دفتره. الأمين يرى دفتره فقط.
7. **النسخ الاحتياطية:** كل يوم تلقائياً، ونسخة ثانية على مفتاح USB (الإدارة ← الخادم).
8. **التحديث:** ثبّت ملف الإعداد الجديد فوق القديم. البيانات لا تُمسّ.
9. **إن انطفأ الخادم:** لا إدخال حتى يعود. يبدأ وحده عند تشغيل الحاسوب.

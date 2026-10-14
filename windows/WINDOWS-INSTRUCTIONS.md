# MAGIS Accounts on Windows · حسابات ماجيس على ويندوز

There are two parts:
- **Part A** is done **only once**, on **one** Windows computer with good internet. It makes the installer.
- **Part B** is done on **every** holder's computer. It installs the program and needs no internet.

---

## Part A: make the installer (only once)

**You need:** Windows 10 or 11, good internet, about 10 GB free space, and 1–2 hours.

1. Copy the folder **`MAGIS-Accounts-source`** to the computer, e.g. onto the Desktop.
2. Open the folder, then the **`windows`** folder.
3. Double-click **`1-installer-les-outils.cmd`**.
   - If Windows says "Windows protected your PC", click **More info → Run anyway**.
   - If it asks "Do you want to allow this app to make changes?", answer **Yes** each time.
   - Wait until it says **Done**. This can take 30–60 minutes.
4. **Restart the computer.**
5. Double-click **`2-construire.cmd`**. Wait 10–20 minutes.
6. A folder opens with the file **`MAGIS Accounts_0.1.0_x64-setup.exe`** (about 3 MB).
   **That file is the Windows program.** Copy it to a USB key or send it on WhatsApp.

If something fails, take a photo of the black window and send it to Fr. Fouad.

---

## Part B: install on a holder's computer

1. Copy **`MAGIS Accounts_0.1.0_x64-setup.exe`** to the computer.
2. Double-click it.
   - If you see "Windows protected your PC", click **More info → Run anyway**. This appears because the program is not signed with a paid certificate; it is safe.
   - The installer may download "WebView2" from Microsoft if it is missing. Most Windows 10/11 computers already have it.
3. Click **Install**. No administrator password is needed.
4. Open **MAGIS Accounts** from the Start menu.

### First opening (holder)
1. The office (Fr. Fouad or the accountant) gives you the **lists package**: a file named `lists-….json`.
2. In the program, choose **A cash holder's computer → Choose lists package…** and pick that file.
3. Choose **your book**, write **your name** and a **PIN** (4 to 8 digits) twice.
4. Choose where to save your file, e.g. `Documents\Roula.db`. **Never delete this file.**

### Every month (holder)
1. Enter your income, expenses and exchanges.
2. **Import / Export → Export entries…**, then send the file to the accountant.
3. When the office sends a new lists package: **Import / Export → Import lists package…**

### Updating the program later
Fr. Fouad sends a new `…-setup.exe`. Double-click it and install over the old one.
**Your data file (`.db`) is not touched.**

---

## الجزء أ: صنع ملف التثبيت (مرة واحدة فقط)

على **حاسوب ويندوز واحد** فيه إنترنت جيد، ومساحة فارغة نحو 10 GB.

1. انسخ المجلد **`MAGIS-Accounts-source`** إلى الحاسوب (مثلاً على سطح المكتب).
2. افتح المجلد، ثم مجلد **`windows`**.
3. انقر مرتين على **`1-installer-les-outils.cmd`**.
   - إن ظهر «Windows protected your PC»، فاضغط **More info ← Run anyway**.
   - إن سأل «السماح بإجراء تغييرات؟»، فأجب **نعم**.
   - انتظر حتى يكتب **Done** (30 إلى 60 دقيقة).
4. **أعد تشغيل الحاسوب.**
5. انقر مرتين على **`2-construire.cmd`** وانتظر 10 إلى 20 دقيقة.
6. يُفتح مجلد فيه الملف **`MAGIS Accounts_0.1.0_x64-setup.exe`**. هذا هو البرنامج: انسخه إلى مفتاح USB أو أرسله بالواتساب.

إن ظهر خطأ، فصوّر النافذة السوداء وأرسل الصورة إلى الأب فؤاد.

## الجزء ب: التثبيت على حاسوب كل أمين صندوق

1. انسخ ملف **`…-setup.exe`** إلى الحاسوب وانقر عليه مرتين.
2. إن ظهر «Windows protected your PC»، فاضغط **More info ← Run anyway**. البرنامج آمن، لكنه غير موقّع بشهادة مدفوعة.
3. اضغط **Install** (لا حاجة إلى كلمة سر المدير)، ثم افتح **MAGIS Accounts** من قائمة ابدأ.

### أول فتح
1. يعطيك المكتب **حزمة القوائم**، وهي ملف `lists-….json`.
2. اختر **حاسوب أمين صندوق ← اختيار حزمة القوائم**، ثم اختر الملف.
3. اختر **دفترك**، واكتب **اسمك** و**رمزاً** من 4 إلى 8 أرقام.
4. احفظ ملفك في `Documents`. **لا تحذف هذا الملف أبداً.**

### كل شهر
1. اكتب إيراداتك ونفقاتك وتصريفك.
2. **استيراد وتصدير ← تصدير القيود**، ثم أرسل الملف إلى المحاسب.
3. حين تصلك حزمة قوائم جديدة: **استيراد وتصدير ← استيراد حزمة القوائم**.

### تحديث البرنامج لاحقاً
ثبّت ملف `setup.exe` الجديد فوق القديم. **ملف بياناتك (`.db`) لا يُمسّ.**

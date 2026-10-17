# حسابات ماجيس · MAGIS Accounts

برنامج مكتبي بلا إنترنت لصندوق المركز النقدي بالليرة والدولار.
An offline desktop program for the centre's cash, in SYP and USD.

---

## العربية

### من يفعل ماذا
| الدور | يستطيع |
|---|---|
| **الرئيس** | كل شيء، ومعه المانحون والمنح والتغطية وأموال المشاريع (سرّي) |
| **المحاسب** | كل شيء ما عدا المانحين والمنح والتغطية |
| **أمين الصندوق** | يكتب قيود دفتره فقط، ويرى رصيده ويعدّ نقده |

الرئيس والمحاسب يعملان على **قاعدة المكتب** نفسها، كلٌّ برمزه. كل أمين يعمل على حاسوبه.

### أول مرة (المكتب)
1. افتح البرنامج ← **قاعدة المكتب**.
2. اكتب اسم المركز، واسم الرئيس ورمزه، واسم المحاسب ورمزه.
3. اترك «ابدأ من ملف Excel الحالي» مؤشَّراً، واختر `Master Sup.xlsx`.
4. اختر مكان حفظ الملف (مثلاً `Documents/MAGIS/MAGIS Homs.db`).
5. يُظهر البرنامج عدد السطور المنقولة وعدد السطور «للمراجعة». لا يُحذف شيء.

### أول مرة (أمين صندوق)
1. في المكتب: **استيراد وتصدير ← حفظ الحزمة** — أرسل الملف `lists-….json` إلى الأمين.
2. على حاسوب الأمين: **حاسوب أمين صندوق** ← اختر الحزمة ← اختر الدفتر ← رمز.

### الروتين الشهري
1. كل أمين: **استيراد وتصدير ← تصدير القيود** ويرسل الملف إلى المحاسب.
2. المحاسب: **استيراد قيود أمين**. ما سبق استيراده يُتخطى — لا تكرار ممكن.
3. **السجل ← للمراجعة**: صحّح كل سطر عليه ⚠.
4. **النقد**: عدّ النقد ورقة ورقة لكل صندوق؛ الفرق يجب أن يكون ✓.
5. **التقارير**: الملخص، شهرياً، التغطية.
6. **الإدارة ← إغلاق الأشهر**: أغلق الشهر. بعد الإغلاق، التصحيح بقيد عكسي.
7. **استيراد وتصدير ← حفظ الحزمة** وأرسلها إلى الأمناء إن تغيّرت القوائم.

### القوائم المنسدلة
كل القوائم في **القوائم**: الموازنة (البنود والخطوط وأي بند لأي نوع)، الدفاتر، الجهات، الحسابات، المشاريع، قواعد الصرف، المانحون، المدن، الإعدادات.
- ما أُضيف يظهر فوراً في النماذج.
- قيمة مستعملة لا تُحذف: **تُوقف**، فتبقى في السطور القديمة وتختفي من النماذج.
- رمز الخط يُعطى مرة واحدة ولا يتغير.

### النسخ الاحتياطية
- نسخة كل يوم عند الفتح، ونسخة قبل كل استيراد، في مجلد `backups` بجانب الملف.
- **الإدارة ← النسخ الاحتياطية ← استرجاع**. تُؤخذ نسخة من الحالي قبل الاسترجاع.
- انسخ مجلد `backups` على مفتاح USB كل شهر.

### إلى Excel
**استيراد وتصدير ← تصدير إلى Excel**: ورقة `Transactions` بجدول `TRX` بنفس ترتيب الأعمدة تماماً، مع القوائم والتقارير. خيار «السجل فقط (B:Q + Entry_ID)» للصق في الملف القديم.

---

## English

### Who does what
| Role | Can |
|---|---|
| **Superior** | Everything, including donors, grants, coverage and project funds (confidential) |
| **Accountant** | Everything except donors, grants and coverage |
| **Cash holder** | Enters the entries of their own book only; sees their balance and counts their cash |

The Superior and the Accountant share the **office database**, each with their own PIN. Each holder works on their own computer.

### First time (office)
1. Open the program → **Office database**.
2. Type the centre name, the Superior's name and PIN, the Accountant's name and PIN.
3. Keep "Start from the current Excel workbook" ticked and choose `Master Sup.xlsx`.
4. Choose where to save the file (e.g. `Documents/MAGIS/MAGIS Homs.db`).
5. The program shows how many rows were imported and how many are "to review". Nothing is dropped.

### First time (cash holder)
1. At the office: **Import / Export → Save package**. Send the `lists-….json` file to the holder.
2. On the holder's computer: **A cash holder's computer** → choose the package → choose the book → PIN.

### Monthly routine
1. Each holder: **Import / Export → Export entries**, then sends the file to the accountant.
2. Accountant: **Import a holder's entries**. Anything already imported is skipped, so nothing can be doubled.
3. **Register → To review**: fix every ⚠ row.
4. **Cash**: count the notes for each holder; the difference must be ✓.
5. **Reports**: Summary, Monthly, Coverage.
6. **Admin → Month closing**: close the month. After closing, corrections go in as a reversing entry.
7. **Import / Export → Save package** and send it to the holders if the lists changed.

### Dropdown lists
All lists live in **Lists**: Budget (headings, lines, which heading for which type), Books, Parties, Accounts, Projects, Spending rules, Donors, Cities, Settings.
- Whatever you add appears in the forms immediately.
- A value already used is never deleted. It is **deactivated**: it stays on old rows and leaves the forms.
- A line code is given once and never changes.

### Backups
- One copy a day on opening, and one before every import, in a `backups` folder next to the file.
- **Admin → Backups → Restore**. A copy of the current file is taken before restoring.
- Copy the `backups` folder to a USB key every month.

### To Excel
**Import / Export → Export to Excel** creates a `Transactions` sheet with a `TRX` table in exactly the workbook's column order, plus the lists and reports. The "Register only (B:Q + Entry_ID)" option is for pasting into the old workbook.

---

## For whoever maintains the program

- `src/domain/compute.ts`: the formula columns R:Z (Rate, USD totals, Code, Bill_Code…).
- `src/domain/validate.ts`: what blocks saving.
- `src/domain/reports.ts`: Holders, Dashboard, Monthly, Coverage, Donors.
- `src/db/migrations.ts`: the schema. **An applied migration is never edited; add a new one.**
- `src-tauri/src/lib.rs`: the thin Rust layer (SQLite file, backups, files).
- **The juge** (`tests/juge.test.ts`) imports `../template/Master Sup.xlsx` and checks that every row's Rate, USD totals and Code, the Holders balances, Spent_USD and Coverage equal what Excel computed. Run it with `verifier.command` (double-click) or `npm test`.
- **Building sites** (setting `building` = 1, e.g. "Homs building"): created from a workbook with the tables `REC` and `Table2` (`Homs compte.xlsx`, read by `readBuildingWorkbook`). Typed rate per row (a new row is offered the last rate typed), bill date + payment date, USD and SYP on one row, bill code `0003 TO 24 2` (`buildingBillCode`), budget per heading (`buildingBudget`, Budget page), rows **cancelled** instead of deleted (only the Superior deletes). Its juge: `tests/juge-building.test.ts` (reads `../../Building comp/Homs compte.xlsx`; skipped if absent).
- Build for Mac: `construire-mac.command`. Windows needs a Windows PC or a GitHub build (not set up yet).

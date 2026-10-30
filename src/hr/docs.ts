// The HR documents as Word files (Fouad, 30 October 2026): the yearly volunteer agreement (his wording, in Arabic,
// then the English translation), the one-time stipend letter, and the payslips. Every page carries the heading of the
// volunteer's centre: its mark on one side, the Jesuit logo on the other, a thin gold line (the MAGIS design), and the
// five values of MAGIS at the foot. The Arabic text takes the Arabic names, the English text the English names.
// Made in the browser from the data of the person; nothing is sent anywhere. `docx` is loaded only when needed.
import type { HrListItem, HrPaper, HrPerson } from './hr';
import type { HrRun, HrRunLine } from './runOps';

const AR = 'Traditional Arabic';
const EN = 'Calibri';
const GOLD = 'B8891B';
const INK = '26292E';
const SOFT = '8A8577';

type Docx = typeof import('docx');
const lib = () => import('docx');

export async function toBytes(doc: import('docx').Document): Promise<Uint8Array> {
  const { Packer } = await lib();
  // toArrayBuffer works in the browser and in Node (toBuffer needs Node: "nodebuffer is not supported by this platform")
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

/** The heading of a document: the centre (its list item, with the first party and who signs) and the two logos. */
export interface DocHead { centre: HrListItem | null; mark: Uint8Array | null; jesuit: Uint8Array | null }

const dmy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '..........');
const dots = (v: string | null | undefined, n = 24) => (v && v.trim() ? v.trim() : '.'.repeat(n));
const money = (n: number | null | undefined, cur: string) => (n == null ? '..........' : cur === 'SYP' ? `${n.toLocaleString('en-US')} ل.س` : `$${n.toLocaleString('en-US')} USD`);
const moneyEn = (n: number | null | undefined, cur: string) => (n == null ? '..........' : cur === 'SYP' ? `${n.toLocaleString('en-US')} SYP` : `$${n.toLocaleString('en-US')} USD`);

/** The person's names and address in each language (the other language when one is missing). */
export function namesOf(p: HrPerson) {
  const en = [p.first_name, p.last_name].filter(Boolean).join(' ');
  return {
    ar: p.name_ar || p.name, en: en || p.name,
    fatherAr: p.father_name_ar || p.father_name, fatherEn: p.father_name || p.father_name_ar,
    addressAr: p.address_ar || p.address, addressEn: p.address || p.address_ar,
  };
}

/** The centre on the documents: the first party, who signs and the city, in both languages. */
export function partyOf(c: HrListItem | null) {
  const cityAr = c?.city_ar || c?.name || '..........', cityEn = c?.city_en || c?.name || '..........';
  return {
    cityAr, cityEn,
    partyAr: c?.party_ar || `الرهبانية اليسوعية – ${cityAr}`, partyEn: c?.party_en || `The Society of Jesus – ${cityEn}`,
    repAr: c?.rep_ar || '..........................', repEn: c?.rep_en || '..........................',
  };
}

/** width and height of a PNG, from its header */
function pngSize(b: Uint8Array): [number, number] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return b.length > 24 ? [v.getUint32(16), v.getUint32(20)] : [1, 1];
}

function helpers(d: Docx) {
  const { Paragraph, TextRun, AlignmentType } = d;
  const ar = (text: string, o: { center?: boolean; bold?: boolean; size?: number; after?: number; color?: string } = {}) => new Paragraph({ bidirectional: true, alignment: o.center ? AlignmentType.CENTER : AlignmentType.START, spacing: { after: o.after ?? 120, line: 340 }, children: [new TextRun({ text, font: AR, size: o.size ?? 28, bold: o.bold, color: o.color, rightToLeft: true })] });
  const en = (text: string, o: { center?: boolean; bold?: boolean; size?: number; after?: number; color?: string } = {}) => new Paragraph({ alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: o.after ?? 110, line: 276 }, children: [new TextRun({ text, font: EN, size: o.size ?? 22, bold: o.bold, color: o.color })] });
  return { ar, en };
}

const PAGE = { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1247, right: 1247, header: 420, footer: 420 } } };

/** The heading (centre mark | centre and Society of Jesus | Jesuit logo, then a gold line) and the foot (the values). */
function frame(d: Docx, head: DocHead) {
  const { Header, Footer, Table, TableRow, TableCell, WidthType, BorderStyle, Paragraph, TextRun, ImageRun, AlignmentType, VerticalAlign } = d;
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const logo = (bytes: Uint8Array | null, height: number, align: (typeof AlignmentType)[keyof typeof AlignmentType]) => {
    if (!bytes) return new Paragraph({ children: [] });
    const [w, h] = pngSize(bytes);
    return new Paragraph({ alignment: align, children: [new ImageRun({ type: 'png', data: bytes, transformation: { width: Math.round((w / h) * height), height } })] });
  };
  const p = partyOf(head.centre);
  const centreName = head.centre?.name ?? '';
  const cell = (children: InstanceType<typeof Paragraph>[], width: number) => new TableCell({ width: { size: width, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, borders: { top: none, bottom: none, left: none, right: none }, children });
  const header = new Header({
    children: [
      new Table({
        width: { size: 9400, type: WidthType.DXA }, columnWidths: [1700, 6000, 1700],
        borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
        rows: [new TableRow({ children: [
          cell([logo(head.mark, 58, AlignmentType.LEFT)], 1700),
          cell([
            new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [new TextRun({ text: `الرهبانية اليسوعية · ماجيس ${p.cityAr}`, font: AR, size: 24, bold: true, color: INK, rightToLeft: true })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Society of Jesus · ${centreName || `MAGIS ${p.cityEn}`}`, font: EN, size: 18, color: SOFT })] }),
          ], 6000),
          cell([logo(head.jesuit, 58, AlignmentType.RIGHT)], 1700),
        ] })],
      }),
      new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 } }, spacing: { after: 120 }, children: [] }),
    ],
  });
  const footer = new Footer({
    children: [
      new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 4, color: GOLD, space: 4 } }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'الضيافة والمشاركة · الحرية والإبداع · الشجاعة والانفتاح · البساطة والجمال · الثقة والمسؤولية', font: AR, size: 16, color: SOFT, rightToLeft: true })], bidirectional: true }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Hospitality & sharing · Freedom & creativity · Courage & openness · Simplicity & beauty · Trust & responsibility', font: EN, size: 14, color: SOFT })] }),
    ],
  });
  return { headers: { default: header }, footers: { default: footer } };
}

/** two signature blocks side by side */
function signatures(d: Docx, a: string, b: string, arabic: boolean) {
  const { Table, TableRow, TableCell, WidthType, BorderStyle } = d;
  const { ar, en } = helpers(d);
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const cell = (t: string) => new TableCell({ width: { size: 4700, type: WidthType.DXA }, borders: { top: none, bottom: none, left: none, right: none }, children: arabic ? [ar(t, { center: true, bold: true }), ar('', { after: 500 })] : [en(t, { center: true, bold: true }), en(' ', { after: 500 })] });
  return new Table({ width: { size: 9400, type: WidthType.DXA }, columnWidths: [4700, 4700], borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }, rows: [new TableRow({ children: [cell(a), cell(b)] })] });
}

export interface DocCtx { person: HrPerson; head: DocHead; maxWeekly: number }

/** The yearly volunteer agreement: Arabic (his text), then the English translation. */
export async function agreementDoc(x: DocCtx, paper: HrPaper): Promise<Uint8Array> {
  const d = await lib();
  const { Document } = d;
  const { ar, en } = helpers(d);
  const n = namesOf(x.person);
  const c = partyOf(x.head.centre);
  const start = dmy(paper.start_date), end = dmy(paper.end_date);
  const amountAr = money(paper.amount, paper.currency), amountEn = moneyEn(paper.amount, paper.currency);
  const fr = frame(d, x.head);
  const arabic = [
    ar('اتفاقية تطوع', { center: true, bold: true, size: 36, after: 200 }),
    ar(`الفريق الأول: ${c.partyAr} يمثله في هذا العقد ${c.repAr} ويشار إليه في هذا العقد بـ الرهبانية اليسوعية`),
    ar(`الفريق الثاني: ويدلّ عليه في هذا العقد بالمتطوع السيد/ة: ${dots(n.ar)}   اسم الأب: ${dots(n.fatherAr)}   يحمل الجنسية: السورية`),
    ar(`يحمل البطاقة الشخصية الرقم الوطني: ${dots(x.person.national_id)}`),
    ar(`المتخذ موطناً مختاراً لضرورة هذا العقد: ${dots(n.addressAr, 40)}`, { after: 200 }),
    ar('مقدمة العقد', { bold: true }),
    ar('لما كان الفريق الأول هم الآباء اليسوعيين في سورية والمعروفة (الرهبانية اليسوعية) ويعملون في مجال الخدمة الرعوية.'),
    ar('ولما كان الفريق الأول يرغب بالتعاقد مع الفريق الثاني للقيام بعمل طوعي وتقديم خدمات (رعوية واجتماعية وثقافية وتأهيلية) وكان الفريق الثاني لديه الخبرة الكافية في هذا المجال والتي هي على سبيل المثال وليس الحصر:'),
    ar('الاستقبال: استقبال رواد البيت وتوجيههم للمكان المناسب – تسجيل الحضور – الاهتمام بالضيافة – الحفاظ على الجو العام للمكان من أجل تحقيق أهداف البيت – ووفقاً لبنود القواعد الأخلاقية.'),
    ar('تسجيل البيانات: تسجيل بيان الطلاب أو بيانات مشتركي الورشات ورقياً والكترونياً.'),
    ar('العناية بالمكان: تجهيز أماكن الأنشطة والاهتمام بنظافتها وترتيبها قبل وبعد بدء النشاط – الاهتمام بالأدوات والتجهيزات وكيفية استخدامها – القيام بإجراءات فتح وإغلاق الدير اليومية.'),
    ar('القيام بمشتريات للمكان.'),
    ar('الأرشفة والحسابات.'),
    ar('التواصل مع رواد البيت للإعلام أو استقبال الحجوزات من خلال الوسائل الرسمية للبيت: الهاتف وصفحة الفيس بوك ومجموعة الواتس اب.'),
    ar('التعاون مع أفراد الفريق والاستعداد لمساعدتهم في مهامهم المختلفة عند الحاجة.'),
    ar('وكل عمل يندرج تحت أهداف العمل الطوعي الذي تسعى الرهبانية دائماً ليكون على أكمل وجه تجاه الغير وكل شخص في هذا المكان.'),
    ar('ولما كان الفريق الثاني يرغب بالعمل ضمن أحد أو عدد من هذه المجالات، وقد اطلع على أنظمة العمل النافذة لديها وقبل بها فقد اتفق الفريقان على ما يلي:', { after: 200 }),
    ar('مادة -1- تعتبر مقدمة هذا العقد جزءاً لا يتجزأ منه.'),
    ar(`مادة -2- تبدأ مدة هذا العقد ${start} وتنتهي بتاريخ ${end} (يعتبر هذا العقد محدد المدة تنفيذاً لأحكام المرسوم التشريعي رقم /68/ لعام 2010) كما لا يخضع هذا العقد لقانون العمل رقم 17 لعام 2010 وفقاً لنص المادة الخامسة منه الفقرة الخامسة.`),
    ar('مادة -3- تعتبر الأشهر الثلاثة الأولى من عمل الفريق الثاني مدة اختبار لا يجوز تكرارها أو زيادتها ولكل من الطرفين إنهاء العقد خلال هذه المدة دون إخطار مسبق أو التزام بتعويض ولا يترتب على الفريق الأول أي مسؤولية في حال إنهائه العقد خلال المدة المذكورة.'),
    ar(`مادة -4- اتفق الفريقان على أن يؤدي الفريق الأول مكافآت للفريق الثاني غير دورية وغير إلزامية مبلغ وقدره (${amountAr}) أو ما يعادلها بالعملة السورية، وهو عبارة عن مكافآت تمنحها الرهبانية اليسوعية نتيجة هذا العمل الطوعي المقدم من الفريق الثاني.`),
    ar(`مادة -5- اتفق الفريقان على تحديد ساعات التطوع للفريق الثاني بـ (6) ساعات يومياً على الأقل ولا تدخل فيها الفترات المخصصة للطعام والراحة. وألّا تتجاوز ساعات التطوع الفعلي المتفق عليها الـ (${x.maxWeekly}) ساعة أسبوعياً.`),
    ar('مادة -6- يجوز للفريق الأول أن ينهي هذا العقد في أي وقت خلال مدة سريانه. ويجوز للفريق الثاني أن ينهي هذا العقد في أي وقت شريطة إعلام (إخطار) الفريق الأول – خطياً – بذلك قبل سبعة أيام من الموعد الذي حدده للانتهاء.'),
    ar('مادة -7- يحق للفريق الأول إنهاء هذا العقد دون إخطار أو مكافأة أو تعويض في حال ثبوت ارتكاب الفريق الثاني مخالفة من المخالفات المحددة في القانون أو في الحالات التالية: توقف العمل – في حال عدم احترام هذا المكان وعدم احترام قوانين الرهبانية اليسوعية – في حال مخالفة أبسط قواعد الاحترام والقواعد الأخلاقية التي وقّع عليها المتطوع وتعهّد بالالتزام بها – في حال حدوث أي قوة قاهرة خارجة عن مقدرة الرهبانية اليسوعية في استدراكها أو إدارتها.'),
    ar('مادة -8- تعهّد المتطوع منذ لحظة التوقيع على هذا العقد، بأنه في حال تم إنهاء هذا العقد لأي سبب من الأسباب التي تم ذكرها سابقاً، بأنه سيقوم بتسليم الرهبانية اليسوعية جميع التجهيزات والموارد والوثائق المؤتمن عليها خلال فترة تطوعه، تحت طائلة ترتيب المساءلة القانونية في حال عدم تسليمها.'),
    ar('مادة -9- يستحق الفريق الثاني راحة أسبوعية مدتها 24 ساعة متواصلة بعد /6/ أيام عمل متواصلة. ويستحق الفريق الثاني الإجازات التالية وفق أحكام قانون العمل الناظمة لاستحقاقها: الإجازات السنوية 10 أيام – الإجازات المرضية 12 يوماً، إضافة إلى إجازات الأعياد وبعض المناسبات الرسمية والإجازات الخاصة بالرهبانية اليسوعية.'),
    ar(`مادة -10- حُرّر هذا العقد على نسخة واحدة في ${c.cityAr} تاريخ ${start}.`, { after: 300 }),
    signatures(d, `الفريق الأول: ${c.repAr}`, `الفريق الثاني: ${dots(n.ar, 16)}`, true),
  ];
  const english = [
    en('Volunteer agreement', { center: true, bold: true, size: 32, after: 40 }),
    en('English translation, for information; the Arabic text is the agreement.', { center: true, size: 18, color: SOFT, after: 200 }),
    en(`First party: ${c.partyEn}, represented in this agreement by ${c.repEn}, hereafter "the Society of Jesus".`),
    en(`Second party: the volunteer ${dots(n.en)}, son/daughter of ${dots(n.fatherEn)}, Syrian nationality, national number ${dots(x.person.national_id)}, domicile chosen for this agreement: ${dots(n.addressEn, 30)}.`, { after: 180 }),
    en('Introduction', { bold: true }),
    en('The first party is the Jesuit Fathers in Syria (the Society of Jesus), who work in pastoral service. The first party wishes to engage the second party for voluntary work and services (pastoral, social, cultural and educational), the second party having the experience for this, for example and not exclusively: reception (welcoming visitors of the house and guiding them, recording attendance, hospitality, keeping the atmosphere of the place in line with the aims of the house and with the ethical rules); recording data of students or workshop participants on paper and electronically; care of the place (preparing and cleaning the activity rooms before and after, looking after tools and equipment, daily opening and closing of the house); purchases for the place; archiving and accounts; communication with visitors through the official means of the house (telephone, Facebook page, WhatsApp group); cooperation with the team; and any work falling under the aims of voluntary work. The second party wishes to work in one or several of these fields, has read the working rules in force and accepts them. The parties agree as follows:', { after: 160 }),
    en('Article 1. The introduction is an integral part of this agreement.'),
    en(`Article 2. This agreement runs from ${start} to ${end}. It is for a fixed term, in application of Legislative Decree no. 68 of 2010, and is not subject to Labour Law no. 17 of 2010, according to its article 5, paragraph 5.`),
    en("Article 3. The first three months of the second party's work are a trial period, which cannot be repeated or extended. During it either party may end the agreement without notice or compensation, and the first party bears no responsibility for ending it in that period."),
    en(`Article 4. The first party gives the second party non-periodic, non-obligatory bonuses of ${amountEn} (or the equivalent in Syrian currency). These are bonuses given by the Society of Jesus as a result of this voluntary work.`),
    en(`Article 5. The volunteer hours are at least 6 hours a day, not counting meal and rest periods, and the actual agreed volunteer hours do not exceed ${x.maxWeekly} hours a week.`),
    en('Article 6. The first party may end this agreement at any time during its term. The second party may end it at any time provided the first party is notified in writing seven days before the date of ending.'),
    en("Article 7. The first party may end this agreement without notice, bonus or compensation if the second party is found to have committed a breach defined by law or in these cases: stopping the work; not respecting the place and the rules of the Society of Jesus; breaking the simplest rules of respect and the ethical rules the volunteer signed and undertook to follow; any force majeure beyond the Society's ability to avoid or manage."),
    en('Article 8. From the moment of signing, the volunteer undertakes that if this agreement ends for any of the reasons above, they will hand back to the Society of Jesus all equipment, resources and documents entrusted to them during the volunteering, failing which they may be held legally accountable.'),
    en('Article 9. The second party is entitled to a weekly rest of 24 continuous hours after 6 continuous working days, and to annual leave of 10 days and sick leave of 12 days according to the labour law provisions governing them, as well as holidays, some official occasions and the special leaves of the Society of Jesus.'),
    en(`Article 10. This agreement is made in one copy in ${c.cityEn} on ${start}.`, { after: 300 }),
    signatures(d, `First party: ${c.repEn}`, `Second party: ${dots(n.en, 16)}`, false),
  ];
  return toBytes(new Document({ sections: [{ properties: PAGE, ...fr, children: arabic }, { properties: PAGE, ...fr, children: english }] }));
}

/** The one-time stipend letter for a named service. */
export async function stipendDoc(x: DocCtx, paper: HrPaper): Promise<Uint8Array> {
  const d = await lib();
  const { Document } = d;
  const { ar, en } = helpers(d);
  const n = namesOf(x.person);
  const c = partyOf(x.head.centre);
  const when = dmy(paper.paid_on);
  const from = dmy(paper.start_date);
  const fr = frame(d, x.head);
  const arabic = [
    ar('رسالة مكافأة لمرة واحدة', { center: true, bold: true, size: 36, after: 240 }),
    ar(`التاريخ: ${dmy(paper.paid_on ?? paper.start_date)}          المكان: ${c.cityAr}`),
    ar(`إلى السيد/ة: ${dots(n.ar)}  ابن/ة: ${dots(n.fatherAr)}`),
    ar(`الرقم الوطني / رقم البطاقة الشخصية: ${dots(x.person.national_id)}`),
    ar('الموضوع: مكافأة عن خدمة محددة', { bold: true, after: 200 }),
    ar(`١- يشكركم ${c.partyAr} على الخدمة التالية التي قدّمتموها طوعاً: ${dots(paper.service, 30)} ابتداءً من ${from}.`),
    ar(`٢- وتقديراً لهذه الخدمة تمنحكم الرهبانية اليسوعية مكافأة لمرة واحدة قدرها (${money(paper.amount, paper.currency)}) أو ما يعادلها بالليرة السورية بسعر الصرف المعتمد يوم الدفع.`),
    ar('٣- هذه المكافأة خاصة بالخدمة المذكورة وحدها، وهي غير دورية وغير إلزامية، ولا تُنشئ علاقة عمل ولا تُعدّ أجراً، ولا تلزم الرهبانية بأي مكافأة لاحقة.'),
    ar(`٤- تُدفع المكافأة بتاريخ ${when}، ويوقّع المتطوع على استلامها أدناه.`, { after: 300 }),
    signatures(d, `الفريق الأول: ${c.repAr}`, `الفريق الثاني: ${dots(n.ar, 16)}`, true),
    ar('', { after: 200 }),
    ar(`إقرار بالاستلام: استلمتُ المبلغ المذكور أعلاه كاملاً بتاريخ ${when}    التوقيع: ..........................`, { size: 26 }),
  ];
  const english = [
    en('One-time stipend letter', { center: true, bold: true, size: 32, after: 240 }),
    en(`Date: ${dmy(paper.paid_on ?? paper.start_date)}          Place: ${c.cityEn}`),
    en(`To: ${dots(n.en)}, son/daughter of ${dots(n.fatherEn)}`),
    en(`National number / ID card number: ${dots(x.person.national_id)}`),
    en('Subject: stipend for a specific service', { bold: true, after: 200 }),
    en(`1. ${c.partyEn} thanks you for the following service, given voluntarily: ${dots(paper.service, 30)}, starting on ${from}.`),
    en(`2. In appreciation of this service, the Society of Jesus grants you a one-time stipend of (${moneyEn(paper.amount, paper.currency)}), or its equivalent in Syrian pounds at the exchange rate of the day of payment.`),
    en('3. This stipend concerns the service named above only. It is non-periodic and non-obligatory, it does not create an employment relationship, it is not a wage, and it does not oblige the Society of Jesus to any later payment.'),
    en(`4. The stipend is paid on ${when}, and the volunteer signs below to confirm receipt.`, { after: 300 }),
    signatures(d, `First party: ${c.repEn}`, `Second party: ${dots(n.en, 16)}`, false),
    en('', { after: 200 }),
    en(`Receipt: I received the full amount above on ${when}    Signature: ..........................`),
  ];
  return toBytes(new Document({ sections: [{ properties: PAGE, ...fr, children: arabic }, { properties: PAGE, ...fr, children: english }] }));
}

const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const monthTitle = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const MONTHS_AR = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const monthAr = (ym: string) => `${MONTHS_AR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** One payslip per person (a person with several lines gets them on one slip), one per page, with their centre's heading. */
export async function payslipsDoc(run: HrRun, lines: HrRunLine[], people: HrPerson[], headOf: (p: HrPerson | undefined) => DocHead): Promise<Uint8Array> {
  const d = await lib();
  const { Document, Table, TableRow, TableCell, WidthType, Paragraph, TextRun, AlignmentType, ShadingType } = d;
  const { ar, en } = helpers(d);
  const byPerson = new Map<number, HrRunLine[]>();
  for (const l of lines) byPerson.set(l.person_id, [...(byPerson.get(l.person_id) ?? []), l]);
  const widths = [3400, 1500, 1500, 1500, 1500];
  const cell = (t: string, i: number, o: { bold?: boolean; right?: boolean; head?: boolean } = {}) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, margins: { top: 70, bottom: 70, left: 90, right: 90 },
    shading: o.head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EFEAE0' } : undefined,
    children: [new Paragraph({ alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: t, font: EN, size: 20, bold: o.bold })] })],
  });
  const sections = [...byPerson.values()].map((ls) => {
    const p = people.find((x) => x.id === ls[0].person_id);
    const n = p ? namesOf(p) : { ar: ls[0].person_name, en: ls[0].person_name };
    const total = ls.reduce((a, l) => a + l.total_usd, 0);
    const paid = [...new Set(ls.map((l) => l.paid_in))].map((c) => `${usd(ls.filter((l) => l.paid_in === c).reduce((a, l) => a + l.amount_paid, 0))} ${c}`).join(' + ');
    const rows = [
      new TableRow({ tableHeader: true, children: ['Item · البند', 'Base · الأساس', 'Bonus · مكافأة', 'Deduction · حسم', 'USD'].map((h, i) => cell(h, i, { bold: true, right: i > 0, head: true })) }),
      ...ls.map((l) => new TableRow({ children: [cell(l.label ?? (run.kind === 'thirteenth' ? '13th payment · الدفعة الثالثة عشرة' : 'Monthly stipend · المكافأة الشهرية'), 0), cell(usd(l.base_usd), 1, { right: true }), cell(l.bonus_usd ? usd(l.bonus_usd) : '', 2, { right: true }), cell(l.deduction_usd ? usd(l.deduction_usd) : '', 3, { right: true }), cell(usd(l.total_usd), 4, { right: true })] })),
      new TableRow({ children: [cell('Total · المجموع', 0, { bold: true, head: true }), cell('', 1, { head: true }), cell('', 2, { head: true }), cell('', 3, { head: true }), cell(usd(total), 4, { bold: true, right: true, head: true })] }),
    ];
    return {
      properties: PAGE,
      ...frame(d, headOf(p)),
      children: [
        ar(`قسيمة دفع — ${monthAr(run.ym)}`, { center: true, bold: true, size: 32, after: 0 }),
        en(`Payslip — ${monthTitle(run.ym)}`, { center: true, size: 22, color: SOFT, after: 240 }),
        ar(`${n.ar}${p?.role ? ` · ${p.role}` : ''}`, { bold: true, size: 28, after: 0 }),
        en(n.en, { bold: true, size: 22, after: 0 }),
        en(`ID · الرقم الوطني: ${dots(ls[0].national_id, 14)}`, { size: 20, after: 200 }),
        new Table({ width: { size: 9400, type: WidthType.DXA }, columnWidths: widths, rows }),
        en('', { after: 160 }),
        en(`Paid in: ${paid}   (1 USD = ${usd(run.rate_syp)} SYP)`),
        ar(`يُدفع بـ: ${paid}`, { size: 24 }),
        en('', { after: 300 }),
        en('Received: ........................          Date: ........../........../..........'),
        ar('استلمتُ: ........................          التاريخ: ........../........../..........', { size: 24 }),
      ],
    };
  });
  return toBytes(new Document({ sections }));
}

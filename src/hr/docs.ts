// The HR documents as Word files (Fouad, 30 October 2026): the yearly volunteer agreement (his wording, in Arabic,
// followed by an English translation), the one-time stipend letter, and the payslips. Made in the browser, from the
// data of the person; nothing is sent anywhere. The `docx` library is loaded only when a document is made.
import type { HrPaper, HrPerson } from './hr';
import type { HrRun, HrRunLine } from './runOps';

const AR = 'Traditional Arabic';
const EN = 'Calibri';

type Docx = typeof import('docx');
const lib = () => import('docx');

export async function toBytes(doc: import('docx').Document): Promise<Uint8Array> {
  const { Packer } = await lib();
  return new Uint8Array(await Packer.toBuffer(doc));
}

const dmy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '..........');
const dots = (v: string | null | undefined, n = 24) => (v && v.trim() ? v.trim() : '.'.repeat(n));
const money = (n: number | null | undefined, cur: string) => (n == null ? '..........' : cur === 'SYP' ? `${n.toLocaleString('en-US')} ل.س` : `$${n.toLocaleString('en-US')} USD`);
const moneyEn = (n: number | null | undefined, cur: string) => (n == null ? '..........' : cur === 'SYP' ? `${n.toLocaleString('en-US')} SYP` : `$${n.toLocaleString('en-US')} USD`);

function helpers(d: Docx) {
  const { Paragraph, TextRun, AlignmentType } = d;
  const ar = (text: string, o: { center?: boolean; bold?: boolean; size?: number; after?: number } = {}) => new Paragraph({ bidirectional: true, alignment: o.center ? AlignmentType.CENTER : AlignmentType.START, spacing: { after: o.after ?? 120, line: 340 }, children: [new TextRun({ text, font: AR, size: o.size ?? 28, bold: o.bold, rightToLeft: true })] });
  const en = (text: string, o: { center?: boolean; bold?: boolean; size?: number; after?: number; pageBreak?: boolean } = {}) => new Paragraph({ pageBreakBefore: o.pageBreak, alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: o.after ?? 110, line: 276 }, children: [new TextRun({ text, font: EN, size: o.size ?? 22, bold: o.bold })] });
  return { ar, en };
}

const page = { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1417, right: 1417 } } };

/** two signature blocks side by side */
function signatures(d: Docx, a: string, b: string, arabic: boolean) {
  const { Table, TableRow, TableCell, WidthType, BorderStyle } = d;
  const { ar, en } = helpers(d);
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const cell = (t: string) => new TableCell({ width: { size: 4500, type: WidthType.DXA }, borders: { top: none, bottom: none, left: none, right: none }, children: arabic ? [ar(t, { center: true, bold: true }), ar('', { after: 500 })] : [en(t, { center: true, bold: true }), en(' ', { after: 500 })] });
  return new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: [4500, 4500], borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }, rows: [new TableRow({ children: [cell(a), cell(b)] })] });
}

export interface DocCtx { org: string; person: HrPerson; repAr: string; repEn: string; maxWeekly: number }

/** The yearly volunteer agreement: Arabic (his text), then the English translation. */
export async function agreementDoc(x: DocCtx, paper: HrPaper): Promise<Uint8Array> {
  const d = await lib();
  const { Document } = d;
  const { ar, en } = helpers(d);
  const p = x.person;
  const place = dots(p.centre, 12);
  const rep = x.repAr || '..........................';
  const repEn = x.repEn || '..........................';
  const start = dmy(paper.start_date), end = dmy(paper.end_date);
  const amountAr = money(paper.amount, paper.currency), amountEn = moneyEn(paper.amount, paper.currency);
  const arabic = [
    ar('اتفاقية تطوع', { center: true, bold: true, size: 36, after: 200 }),
    ar(`الفريق الأول: الرهبانية اليسوعية – ${place} يمثلها في هذا العقد ${rep} ويشار إليها في هذا العقد بـ الرهبانية اليسوعية`),
    ar(`الفريق الثاني: ويدلّ عليه في هذا العقد بالمتطوع السيد/ة: ${dots(p.name)}   اسم الأب: ${dots(p.father_name)}   يحمل الجنسية: السورية`),
    ar(`يحمل البطاقة الشخصية الرقم الوطني: ${dots(p.national_id)}`),
    ar(`المتخذ موطناً مختاراً لضرورة هذا العقد: ${dots(p.address, 40)}`, { after: 200 }),
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
    ar(`مادة -10- حُرّر هذا العقد على نسخة واحدة في ${place} تاريخ ${start}.`, { after: 300 }),
    signatures(d, `الفريق الأول: ${rep}`, `الفريق الثاني: ${dots(p.name, 16)}`, true),
  ];
  const english = [
    en('Volunteer agreement (English translation, for information)', { center: true, bold: true, size: 30, after: 200, pageBreak: true }),
    en(`First party: the Society of Jesus – ${dots(p.centre, 12)}, represented in this agreement by ${repEn}, hereafter "the Society of Jesus".`),
    en(`Second party: the volunteer ${dots(p.name)}, son/daughter of ${dots(p.father_name)}, Syrian nationality, national number ${dots(p.national_id)}, domicile chosen for this agreement: ${dots(p.address, 30)}.`, { after: 180 }),
    en('Introduction', { bold: true }),
    en('The first party is the Jesuit Fathers in Syria (the Society of Jesus), who work in pastoral service. The first party wishes to engage the second party for voluntary work and services (pastoral, social, cultural and educational), the second party having the experience for this, for example and not exclusively: reception (welcoming visitors of the house and guiding them, recording attendance, hospitality, keeping the atmosphere of the place in line with the aims of the house and with the ethical rules); recording data of students or workshop participants on paper and electronically; care of the place (preparing and cleaning the activity rooms before and after, looking after tools and equipment, daily opening and closing of the monastery); purchases for the place; archiving and accounts; communication with visitors through the official means of the house (telephone, Facebook page, WhatsApp group); cooperation with the team; and any work falling under the aims of voluntary work. The second party wishes to work in one or several of these fields, has read the working rules in force and accepts them. The parties agree as follows:', { after: 160 }),
    en('Article 1. The introduction is an integral part of this agreement.'),
    en(`Article 2. This agreement runs from ${start} to ${end}. It is for a fixed term, in application of Legislative Decree no. 68 of 2010, and is not subject to Labour Law no. 17 of 2010, according to its article 5, paragraph 5.`),
    en('Article 3. The first three months of the second party\'s work are a trial period, which cannot be repeated or extended. During it either party may end the agreement without notice or compensation, and the first party bears no responsibility for ending it in that period.'),
    en(`Article 4. The first party gives the second party non-periodic, non-obligatory bonuses of ${amountEn} (or the equivalent in Syrian currency). These are bonuses given by the Society of Jesus as a result of this voluntary work.`),
    en(`Article 5. The volunteer hours are at least 6 hours a day, not counting meal and rest periods, and the actual agreed volunteer hours do not exceed ${x.maxWeekly} hours a week.`),
    en('Article 6. The first party may end this agreement at any time during its term. The second party may end it at any time provided the first party is notified in writing seven days before the date of ending.'),
    en('Article 7. The first party may end this agreement without notice, bonus or compensation if the second party is found to have committed a breach defined by law or in these cases: stopping the work; not respecting the place and the rules of the Society of Jesus; breaking the simplest rules of respect and the ethical rules the volunteer signed and undertook to follow; any force majeure beyond the Society\'s ability to avoid or manage.'),
    en('Article 8. From the moment of signing, the volunteer undertakes that if this agreement ends for any of the reasons above, they will hand back to the Society of Jesus all equipment, resources and documents entrusted to them during the volunteering, failing which they may be held legally accountable.'),
    en('Article 9. The second party is entitled to a weekly rest of 24 continuous hours after 6 continuous working days, and to annual leave of 10 days and sick leave of 12 days according to the labour law provisions governing them, as well as holidays, some official occasions and the special leaves of the Society of Jesus.'),
    en(`Article 10. This agreement is made in one copy in ${dots(p.centre, 12)} on ${start}.`, { after: 300 }),
    signatures(d, `First party: ${repEn}`, `Second party: ${dots(p.name, 16)}`, false),
  ];
  return toBytes(new Document({ sections: [{ properties: page, children: arabic }, { properties: page, children: english }] }));
}

/** The one-time stipend letter for a named service. */
export async function stipendDoc(x: DocCtx, paper: HrPaper): Promise<Uint8Array> {
  const d = await lib();
  const { Document } = d;
  const { ar, en } = helpers(d);
  const p = x.person;
  const place = dots(p.centre, 12);
  const when = dmy(paper.paid_on);
  const from = dmy(paper.start_date);
  const arabic = [
    ar(`الرهبانية اليسوعية – ${place}`, { center: true, bold: true, size: 30 }),
    ar('رسالة مكافأة لمرة واحدة', { center: true, bold: true, size: 36, after: 240 }),
    ar(`التاريخ: ${dmy(paper.paid_on ?? paper.start_date)}          المكان: ${place}`),
    ar(`إلى السيد/ة: ${dots(p.name)}  ابن/ة: ${dots(p.father_name)}`),
    ar(`الرقم الوطني / رقم البطاقة الشخصية: ${dots(p.national_id)}`),
    ar('الموضوع: مكافأة عن خدمة محددة', { bold: true, after: 200 }),
    ar(`١- تشكركم الرهبانية اليسوعية على الخدمة التالية التي قدّمتموها طوعاً: ${dots(paper.service, 30)} ابتداءً من ${from} في ${place}.`),
    ar(`٢- وتقديراً لهذه الخدمة تمنحكم الرهبانية اليسوعية مكافأة لمرة واحدة قدرها (${money(paper.amount, paper.currency)}) أو ما يعادلها بالليرة السورية بسعر الصرف المعتمد يوم الدفع.`),
    ar('٣- هذه المكافأة خاصة بالخدمة المذكورة وحدها، وهي غير دورية وغير إلزامية، ولا تُنشئ علاقة عمل ولا تُعدّ أجراً، ولا تلزم الرهبانية بأي مكافأة لاحقة.'),
    ar(`٤- تُدفع المكافأة بتاريخ ${when}، ويوقّع المتطوع على استلامها أدناه.`, { after: 300 }),
    signatures(d, `الفريق الأول: ${x.repAr || '....................'}`, `الفريق الثاني: ${dots(p.name, 16)}`, true),
    ar('', { after: 200 }),
    ar(`إقرار بالاستلام: استلمتُ المبلغ المذكور أعلاه كاملاً بتاريخ ${when}    التوقيع: ..........................`, { size: 26 }),
  ];
  const english = [
    en(`Society of Jesus – ${dots(p.centre, 12)}`, { center: true, bold: true, size: 26, pageBreak: true }),
    en('One-time stipend letter', { center: true, bold: true, size: 32, after: 240 }),
    en(`Date: ${dmy(paper.paid_on ?? paper.start_date)}          Place: ${dots(p.centre, 12)}`),
    en(`To: ${dots(p.name)}, son/daughter of ${dots(p.father_name)}`),
    en(`National number / ID card number: ${dots(p.national_id)}`),
    en('Subject: stipend for a specific service', { bold: true, after: 200 }),
    en(`1. The Society of Jesus thanks you for the following service, given voluntarily: ${dots(paper.service, 30)}, starting on ${from} at ${dots(p.centre, 12)}.`),
    en(`2. In appreciation of this service, the Society of Jesus grants you a one-time stipend of (${moneyEn(paper.amount, paper.currency)}), or its equivalent in Syrian pounds at the exchange rate of the day of payment.`),
    en('3. This stipend concerns the service named above only. It is non-periodic and non-obligatory, it does not create an employment relationship, it is not a wage, and it does not oblige the Society of Jesus to any later payment.'),
    en(`4. The stipend is paid on ${when}, and the volunteer signs below to confirm receipt.`, { after: 300 }),
    signatures(d, `First party: ${x.repEn || '....................'}`, `Second party: ${dots(p.name, 16)}`, false),
    en('', { after: 200 }),
    en(`Receipt: I received the full amount above on ${when}    Signature: ..........................`),
  ];
  return toBytes(new Document({ sections: [{ properties: page, children: arabic }, { properties: page, children: english }] }));
}

const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const monthTitle = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/** One payslip per person (a person with several lines gets them on one slip), one per page, in Word. */
export async function payslipsDoc(org: string, run: HrRun, lines: HrRunLine[], people: HrPerson[]): Promise<Uint8Array> {
  const d = await lib();
  const { Document, Table, TableRow, TableCell, WidthType, Paragraph, TextRun, AlignmentType } = d;
  const { ar, en } = helpers(d);
  const byPerson = new Map<number, HrRunLine[]>();
  for (const l of lines) byPerson.set(l.person_id, [...(byPerson.get(l.person_id) ?? []), l]);
  const widths = [3400, 1400, 1400, 1400, 1400];
  const cell = (t: string, i: number, bold = false, right = false) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: t, font: EN, size: 20, bold })] })] });
  const sections = [...byPerson.values()].map((ls) => {
    const p = people.find((x) => x.id === ls[0].person_id);
    const total = ls.reduce((a, l) => a + l.total_usd, 0);
    const paid = [...new Set(ls.map((l) => l.paid_in))].map((c) => `${usd(ls.filter((l) => l.paid_in === c).reduce((a, l) => a + l.amount_paid, 0))} ${c}`).join(' + ');
    const rows = [
      new TableRow({ tableHeader: true, children: ['Item · البند', 'Base · الأساس', 'Bonus · مكافأة', 'Deduction · حسم', 'USD'].map((h, i) => cell(h, i, true, i > 0)) }),
      ...ls.map((l) => new TableRow({ children: [cell(l.label ?? (run.kind === 'thirteenth' ? '13th payment · الدفعة الثالثة عشرة' : 'Monthly stipend · المكافأة الشهرية'), 0), cell(usd(l.base_usd), 1, false, true), cell(l.bonus_usd ? usd(l.bonus_usd) : '', 2, false, true), cell(l.deduction_usd ? usd(l.deduction_usd) : '', 3, false, true), cell(usd(l.total_usd), 4, false, true)] })),
      new TableRow({ children: [cell('Total · المجموع', 0, true), cell('', 1), cell('', 2), cell('', 3), cell(usd(total), 4, true, true)] }),
    ];
    return {
      properties: page,
      children: [
        en(org, { bold: true, size: 30 }),
        en(`Payslip — ${monthTitle(run.ym)}`, { size: 26, after: 40 }),
        ar(`قسيمة دفع — ${monthTitle(run.ym)}`, { size: 26, after: 200 }),
        en(`${p?.name ?? ls[0].person_name}${p?.role ? ` · ${p.role}` : ''}`, { bold: true, size: 24 }),
        ar(`الرقم الوطني: ${dots(ls[0].national_id, 14)}`, { size: 24, after: 200 }),
        new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: widths, rows }),
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

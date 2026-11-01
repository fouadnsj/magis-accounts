// The guide inside the program (Fouad, 2026-11-02): the steps of grants and projects, and of the one list for every
// centre, with the names of the buttons as they are on the screens.
import type { ReactNode } from 'react';
import { useApp } from '../state';
import { t } from './kit';
import { useNav, type Page } from './Shell';

function Step({ n, title, children, go }: { n: number; title: string; children: ReactNode; go?: { page: Page; label: string } }) {
  const nav = useNav();
  return (
    <li style={{ marginBottom: 12 }}>
      <b>{n}. {title}</b>
      <div style={{ marginTop: 3 }}>{children}</div>
      {go && <button className="link small" onClick={() => nav.go(go.page)}>→ {go.label}</button>}
    </li>
  );
}

export function Guide() {
  const { can } = useApp();
  const lists = can('lists.manage');
  const grants = can('lists.donors');
  return (
    <>
      <div className="page-head"><h1>📖 {t('الدليل', 'Guide')}</h1></div>

      <div className="panel" style={{ maxWidth: 860 }}>
        <h2 style={{ marginTop: 0 }}>{t('المنح والمشاريع', 'Grants and projects')}</h2>
        <p className="muted">{t('المنحة يعطيها مانح، وقد تُقسم بين المراكز. حصة كل مركز مشروع فيه. في الموازنة لكل خط مشروع واحد، أو «غير ممول». كل نفقة تأخذ مشروعها من خطها.', 'A grant is given by a donor and may be divided between the centres. Each centre\'s share is a project there. In the budget each line has one project, or "not funded". Each expense takes its project from its line.')}</p>
        <ol style={{ listStyle: 'none', paddingInlineStart: 0 }}>
          <Step n={1} title={t('اكتب المنحة', 'Write the grant')} go={grants ? { page: 'grants', label: t('المنح', 'Grants') } : undefined}>
            {t('في «المنح» ← «＋ منحة»: المانح، رقم العقد، المبلغ، وحصة كل مركز إن كانت مقسومة. حصة هذا المركز تذهب إلى مشروع واحد (موجود، أو جديد باسم المنحة). المشروع لا يكون لمنحتين.', 'In Grants → "＋ Grant": the donor, the contract number, the amount, and each centre\'s share if it is divided. This centre\'s share goes to one project (an existing one, or a new one with the grant\'s name). A project never has two grants.')}
          </Step>
          <Step n={2} title={t('المشاريع', 'The projects')} go={lists ? { page: 'lists', label: t('القوائم ← المشاريع', 'Lists → Projects') } : undefined}>
            {t('في «القوائم ← المشاريع»: مشاريع المنح، والمشاريع الخاصة (مال بلا منحة). «خارج الموازنة» لمشروع مثل الدير: ما يُصرف منه ليس من موازنة المركز. «دمج» ينقل كل ما كُتب على حساب قديم إلى مشروع آخر.', 'In Lists → Projects: the grants\' projects, and private projects (money without a grant). "Outside the budget" is for a project like Deir: what it spends is not in the centre\'s budget. "Merge" moves everything written on an old account to another project.')}
          </Step>
          <Step n={3} title={t('الموازنة', 'The budget')} go={can('budget.view') ? { page: 'budget', label: t('الموازنة', 'Budget') } : undefined}>
            {t('موازنة واحدة للمركز لكل فترة، بكل المصاريف. أعطِ كل خط مشروعه: في «الموازنة» (عمود المشروع، أو سطر البند لكل خطوطه)، أو في «المشاريع» ← «أعطه خطوطاً…». ما لا مشروع له يظهر «غير ممول». «المشاريع» يُظهر لكل مشروع ماله مقابل خطوطه: «ينقص» أو «لم يُعطَ لخطوط بعد».', 'One budget for the centre for each period, with every expense. Give each line its project: in Budget (the Project column, or the heading\'s row for all its lines), or in Projects → "Give it lines…". What has no project shows "Not funded". "Projects" shows each project\'s money against its lines: "Short by" or "Not yet given to lines".')}
          </Step>
          <Step n={4} title={t('السجل', 'The register')} go={{ page: 'register', label: t('السجل', 'Register') }}>
            {t('من يكتب نفقة يختار الخط فقط: المشروع يأتي من الخط. مشروع خارج الموازنة (الدير) يُختار باليد. إن تغيّر مشروع خط في الموازنة، تتبعه النفقات المكتوبة.', 'Whoever writes an expense chooses the line only: the project comes from the line. A project outside the budget (Deir) is chosen by hand. When a line\'s project changes in the budget, the expenses already written follow it.')}
          </Step>
          <Step n={5} title={t('التقارير', 'The reports')} go={{ page: 'reports', label: t('التقارير', 'Reports') }}>
            {t('«حسب المشروع»: لكل مشروع ما استُلم وما صُرف وما بقي، خطاً بخط، وملف Excel للمانح. «كل المراكز» و«التحليل ← كل المراكز» على الخادم: كل المراكز معاً.', '"By project": for each project what was received, spent and left, line by line, and an Excel file for the donor. "All centres" and "Explore → All centres" on the server: every centre together.')}
          </Step>
          <Step n={6} title={t('الموارد البشرية', 'HR')}>
            {t('مكافأة كل شخص يدفعها مشروع خط موازنته. بعد تغيير مشاريع الموازنة: في الموارد البشرية ← الإعدادات، انسخ القوائم من المركز مرة أخرى.', "Each person's stipend is paid by the project of their budget line. After the budget's projects change: in HR → Settings, copy the lists from the centre again.")}
          </Step>
        </ol>
      </div>

      <div className="panel" style={{ maxWidth: 860 }}>
        <h2 style={{ marginTop: 0 }}>{t('قائمة واحدة لكل المراكز', 'One list for every centre')}</h2>
        <p className="muted">{t('البنود والخطوط نفسها في جرمانا وحلب وحمص، فتُجمع التقارير بين المراكز. يضيف المركز خطاً فيصير للجميع (يصل موقوفاً عند الآخرين)، ويوقف لنفسه ما لا يستعمله. كل الأزرار في «القوائم ← الموازنة».', 'The same headings and lines in Jaramana, Aleppo and Homs, so the reports add up across the centres. A centre adds a line and it is for everyone (it arrives switched off in the others); it switches off, for itself, what it does not use. Every button is in Lists → Budget.')}</p>
        <ol style={{ listStyle: 'none', paddingInlineStart: 0 }}>
          <Step n={1} title={t('ابدأ القائمة المشتركة — مرة واحدة، في حمص', 'Start the common list — once, in Homs')} go={lists ? { page: 'lists', label: t('القوائم', 'Lists') } : undefined}>
            {t('في حمص: «ابدأ القائمة المشتركة من هذه القاعدة». تصير قائمة حمص القائمة المشتركة، وحمص تقودها: أسماؤها ورموزها هي المرجع.', 'In Homs: "Start the common list from this database". Homs\'s list becomes the common list, and Homs leads it: its names and codes are the reference.')}
          </Step>
          <Step n={2} title={t('انضم إلى القائمة المشتركة — مرة واحدة في كل مركز آخر', 'Join the common list — once in each other centre')}>
            {t('في حلب (ثم جرمانا): «انضم إلى القائمة المشتركة…». لكل بند وخط قديم، اختر ما يصيره، أو «أضفه كما هو». الأسماء نفسها مقترحة. عدة خطوط إلى خط واحد تُدمج فيه: مثلاً رواتب كل شخص (سليم، فاطمة…) ← «الرواتب ← الاستقبال». القيود والموازنة تنتقل؛ التواريخ والمبالغ لا تتغير. تُؤخذ نسخة احتياطية أولاً.', 'In Aleppo (then Jaramana): "Join the common list…". For each old heading and line, choose what it becomes, or "add it as it is". The same names are proposed. Several lines to one line are merged into it: e.g. the salary of each person (Salim, Fatima…) → "Salary › Reception". The rows and the budget move; dates and amounts do not change. A backup is taken first.')}
          </Step>
          <Step n={3} title={t('اجعل القوائم واحدة — على الخادم، كلما أُضيفت خطوط', 'Make the lists the same — on the server, whenever lines were added')}>
            {t('«اجعل القوائم واحدة على هذا الخادم»: تجمع الخطوط الجديدة من كل القواعد وتعطي القائمة المشتركة لكل واحدة. لا يُحذف شيء.', '"Make the lists the same on this server": gathers the new lines of every database and gives the common list to each. Nothing is deleted.')}
          </Step>
          <Step n={4} title={t('مركز على حاسوبه', 'A centre on its own computer')}>
            {t('في المركز: «احفظ القائمة ملفاً» واحمل الملف إلى الخادم ← «خذ ملف قائمة» (تأتي خطوطه الجديدة). ثم في حمص: «احفظ القائمة ملفاً» واحمله إلى المركز ← «خذ ملف قائمة» (تأتي القائمة المشتركة بأسمائها).', 'In the centre: "Save the list as a file", bring the file to the server → "Take a list file" (its new lines come in). Then in Homs: "Save the list as a file", bring it to the centre → "Take a list file" (the common list comes, with its names).')}
          </Step>
          <Step n={5} title={t('شغّل ما تستعمله', 'Switch on what you use')}>
            {t('الخط الذي يأتي من مركز آخر يصل موقوفاً. في «القوائم ← الموازنة»، شغّل الخطوط التي يستعملها مركزك.', 'A line that comes from another centre arrives switched off. In Lists → Budget, switch on the lines your centre uses.')}
          </Step>
          <Step n={6} title={t('انظر إلى كل المراكز معاً', 'See every centre together')} go={{ page: 'reports', label: t('التقارير', 'Reports') }}>
            {t('«التحليل ← كل المراكز»: النفقات والإيرادات حسب البند والخط والمشروع والمركز، شهراً بشهر. مركز لم ينضم بعد تبقى بنوده وحدها.', '"Explore → All centres": expenses and income by heading, line, project and centre, month by month. A centre that has not joined yet keeps its headings apart.')}
          </Step>
        </ol>
      </div>
    </>
  );
}

// The chart of codes of a community database (Jesuit communities).
// Source: Fouad's register example, Cty/suggestion/compt1.xlsm, sheet "Reference",
// with the corrections Fouad decided on 18 October 2026:
//  - the second 61201 (Studies) is 61202;
//  - 31302 / 31303 are 61302 / 61303 (typing slips);
//  - "Doctors | Labs" (61401) is split: Doctors 61401 + Medical tests 61405;
//  - where the Comptapro FDC differs, compt1 wins; two lines are added for the FDC:
//    Parking 62053 and Other expenses 65900 (the FDC's 80000).
// Added for the Minister's sheet (Comptapro-Ministre), which compt1 does not detail:
//  - under 73000, the help of the Caisse de Prévoyance (elderly fathers, health) and of the Caisse des Séminaires;
//  - under 64100 Quotas, the cotisations Province, JCEP and AP.
// "70000 From the econome" is not an account here: money from the econome is a transfer between books.
//
// scope: P = offered in a personal book (the FDC lines) and in the house book;
//        H = house book only (the Minister's extra lines).
// The Province econome may later change a code, a name, or add a line (cty_account).

export type CtyType = 'Income' | 'Exp';
export type Scope = 'P' | 'H';
export type ClaimReason = 'health' | 'scholastic' | 'provincial' | 'other';

export interface ChartSeed {
  code: string;
  parent: string | null;
  type: CtyType;
  en: string;
  fr: string;
  ar: string;
  scope: Scope;
  /** an expense on this line offers "to claim from the Province" by default */
  claim?: ClaimReason;
}

const I = (code: string, parent: string | null, en: string, fr: string, ar: string, scope: Scope = 'H'): ChartSeed => ({ code, parent, type: 'Income', en, fr, ar, scope });
const E = (code: string, parent: string | null, en: string, fr: string, ar: string, scope: Scope = 'H', claim?: ClaimReason): ChartSeed => ({ code, parent, type: 'Exp', en, fr, ar, scope, claim });

export const CHART: ChartSeed[] = [
  // ---------------------------------------------------------------- income
  I('71000', null, 'Ordinary income', 'Revenus ordinaires', 'دخل عادي', 'P'),
  I('71100', '71000', 'Pension', 'Pension, assurance', 'معاش تقاعدي', 'P'),
  I('71200', '71000', 'Salary', 'Salaire', 'معاش / مرتب', 'P'),
  I('71300', '71000', 'Remunerations (Mass intentions…)', 'Intentions de messe, rémunérations', 'أجور أخرى غير مرتبطة بنشاط رعوي', 'P'),
  I('71400', '71000', 'Royalties', "Droits d'auteur", 'حقوق نشر', 'P'),
  I('71600', '71000', 'Ministry stipend', 'Ministères', 'رواتب خدمات كهنوتية', 'P'),
  I('71700', '71000', 'Offerings', 'Offrandes', 'لمات , تبرعات , نذورات'),
  I('71701', '71700', 'Collection', 'Quêtes', 'لمات'),
  I('71702', '71700', 'Tithes & offerings', 'Dîmes et offrandes', 'تبرعات , نذورات'),
  I('71800', '71000', 'Hosting', 'Hébergement', 'إستضافة'),
  I('71801', '71800', 'Hosting: retreat centre', 'Hébergement : maison de retraites', 'دخل بيت الرياضات'),
  I('71802', '71800', 'Hosting: guests', 'Hôtes', 'ضيوف'),
  I('71900', '71000', 'Other ordinary income', 'Autres revenus ordinaires', 'مداخيل عادية أخرى'),
  I('72000', null, 'Extraordinary income', 'Revenus extraordinaires', 'مداخيل غير عادية', 'P'),
  I('72100', '72000', 'Grants', 'Subventions (projet)', 'هبة في سبيل تمويل مشروع معين'),
  I('72200', '72000', 'Donations', 'Dons, quêtes', 'هبة حرة غير مقيدة', 'P'),
  I('72300', '72000', 'Sales', 'Ventes', 'مبيعات'),
  I('72400', '72000', 'Other extraordinary income', 'Autres recettes extraordinaires', 'مداخيل غير عادية أخرى'),
  I('73000', null, 'Assistance from the Province funds', 'Aide des caisses de la Province', 'مساعدة من صندوق الاقليم'),
  I('73100', '73000', 'Caisse de Prévoyance: elderly fathers', 'Caisse de Prévoyance : pères âgés', 'صندوق الضمان: الآباء المسنّون'),
  I('73200', '73000', 'Caisse de Prévoyance: health', 'Caisse de Prévoyance : santé', 'صندوق الضمان: الصحة'),
  I('73300', '73000', 'Caisse des Séminaires', 'Caisse des Séminaires', 'صندوق الإكليريكيات'),

  // ---------------------------------------------------------------- expenses
  E('61000', null, 'Support expenses', 'Dépenses de subsistance', 'مصاريف معيشية', 'P'),
  E('61100', '61000', 'Food & accommodation', 'Alimentation, séjours', 'إقامة في الدير وخارجه , تغذية , مشروبات', 'P'),
  E('61101', '61100', 'Food & beverage', 'Nourriture, boisson', 'تغذية , مشروبات', 'P'),
  E('61102', '61100', 'Stay outside the house', 'Séjours extérieurs', 'إقامة خارج الدير', 'P'),
  E('61200', '61000', 'Formation', 'Formation', 'تنشئة | دراسة', 'P'),
  E('61201', '61200', 'Books', 'Livres', 'كتب', 'P'),
  E('61202', '61200', 'Studies: courses, conferences', 'Conférences, cours', 'محاضرات , دروس , دورات', 'P'),
  E('61203', '61200', 'Culture: cinema, theatre', 'Cinéma, théâtre', 'سينما, مسرح', 'P'),
  E('61204', '61200', 'Sports', 'Sport', 'رياضة', 'P'),
  E('61300', '61000', 'Clothing & personal', 'Dépenses personnelles', 'ثياب , مصاريف شخصية', 'P'),
  E('61301', '61300', 'Clothing', 'Vêtements', 'ثياب', 'P'),
  E('61302', '61300', 'Personal items', 'Entretien personnel', 'حاجات شخصية', 'P'),
  E('61303', '61300', 'Administrative procedures', 'Formalités, taxes', 'معاملات رسمية', 'P'),
  E('61400', '61000', 'Health', 'Soins et santé', 'رعاية صحية', 'P', 'health'),
  E('61401', '61400', 'Doctors', 'Consultations', 'معاينة طبية', 'P', 'health'),
  E('61405', '61400', 'Medical tests', 'Analyses médicales', 'تحاليل', 'P', 'health'),
  E('61402', '61400', 'Medicine', 'Pharmacie', 'أدوية', 'P', 'health'),
  E('61403', '61400', 'Hospital', 'Hôpital', 'مستشفى', 'P', 'health'),
  E('61404', '61400', 'Care', 'Soins', 'علاج فيزيائي , زجاجات طبية , رباطات', 'P', 'health'),
  E('61500', '61000', 'Alms and gifts', 'Aumônes', 'صدقات', 'P'),
  E('61600', '61000', 'Spiritual exercises', 'Retraite personnelle', 'رياضة روحية', 'P'),
  E('62000', null, 'Common expenses', 'Dépenses communes', 'مصاريف مشتركة', 'P'),
  E('62010', '62000', 'Cars', 'Voiture', 'سيارات', 'P'),
  E('62011', '62010', 'Cars: fuel', 'Essence', 'وقود', 'P'),
  E('62012', '62010', 'Cars: maintenance', 'Entretien voiture', 'صيانة', 'P'),
  E('62013', '62010', 'Cars: insurance', 'Assurance voiture', 'تأمين'),
  E('62020', '62000', 'Furniture', 'Mobilier', 'فرش'),
  E('62030', '62000', 'Equipment', 'Équipements de maison', 'أدوات'),
  E('62050', '62000', 'Transportation', 'Déplacements', 'تنقل', 'P'),
  E('62051', '62050', 'Public transportation', 'Transports', 'نقل مشترك', 'P'),
  E('62052', '62050', 'Bicycles', 'Vélos', 'دراجات هوائية', 'P'),
  E('62053', '62050', 'Parking', 'Parking', 'موقف سيارات', 'P'),
  E('62060', '62000', 'House repairs & maintenance', 'Entretien de la maison', 'تصليحات , صيانة , حديقة'),
  E('62061', '62060', 'House cleaning', 'Ménage', 'تنظيف المنزل'),
  E('62062', '62060', 'House repairs', 'Réparations de la maison', 'صيانة المنزل'),
  E('62063', '62060', 'House chapel', 'Chapelle', 'كنيسة البيت'),
  E('62064', '62060', 'Gardening', 'Jardin', 'مصاريف حدائق'),
  E('62070', '62000', 'Employees', 'Employés', 'موظفين'),
  E('62080', '62000', 'Apostolic expenses', 'Dépenses apostoliques', 'مصاريف رسالة', 'P'),
  E('62081', '62080', 'Retreats', 'Retraites', 'بيت رياضات', 'P'),
  E('62082', '62080', 'Church', 'Église', 'الكنيسة'),
  E('62083', '62080', 'Other ministries', 'Autres ministères', 'خدمات رسولية', 'P'),
  E('62090', '62000', 'Professional fees', 'Honoraires', 'خدمات حسابية أو قانونية'),
  E('62100', '62000', 'Office & phone', 'Bureau, téléphone', 'مكتب | خليوي', 'P'),
  E('62101', '62100', 'Stationery', 'Papeterie', 'قرطاسية', 'P'),
  E('62102', '62100', 'Post', 'Poste, courrier', 'بريد', 'P'),
  E('62103', '62100', 'Computer', 'Ordinateur', 'حاسوب', 'P'),
  E('62104', '62100', 'Mobile phone', 'Téléphone', 'جهاز خليوي', 'P'),
  E('63000', null, 'General expenses', 'Dépenses générales', 'مصاريف عامة'),
  E('63100', '63000', 'Electricity', 'Électricité', 'كهرباء'),
  E('63200', '63000', 'Water', 'Eau', 'مياه'),
  E('63300', '63000', 'Gas', 'Gaz', 'غاز'),
  E('63400', '63000', 'Communications', 'Internet, tél. fixe', 'إتصالات'),
  E('63500', '63000', 'Insurance', 'Assurance', 'تأمينات'),
  E('63600', '63000', 'Generator', 'Générateur', 'مولّد'),
  E('63601', '63600', 'Generator: diesel', 'Générateur : gasoil', 'وقود'),
  E('63602', '63600', 'Generator: maintenance', 'Générateur : entretien', 'صيانة'),
  E('64000', null, 'Sharing of goods', 'Partage des biens', 'مشاركة الخيرات'),
  E('64100', '64000', 'Quotas', 'Cotisations', 'مساهمات (في مصاريف الاقليم والرهبانية)'),
  E('64101', '64100', 'Cotisation Province', 'Cotisation Province', 'مساهمة الإقليم'),
  E('64102', '64100', 'Cotisation JCEP', 'Cotisation JCEP', 'مساهمة JCEP'),
  E('64103', '64100', 'Cotisation AP', 'Cotisation AP', 'مساهمة AP'),
  E('64200', '64000', 'Taxes', 'Impôts', 'ضريبة'),
  E('64300', '64000', 'FACSI', 'FACSI', 'فاكسي'),
  E('65000', null, 'Extraordinary expenses', 'Dépenses extraordinaires', 'مصاريف غير عادية', 'P'),
  E('65100', '65000', 'Contractors', 'Entrepreneurs', 'مقاولين'),
  E('65200', '65000', 'International travel', "Voyages à l'étranger", 'سفر خارجي', 'P'),
  E('65300', '65000', 'Major works', 'Gros travaux', 'تصليحات كبيرة أو بناء'),
  E('65301', '65300', 'Major repairs: building', 'Gros travaux : bâtiment', 'أبنية'),
  E('65302', '65300', 'Major repairs: landscaping', 'Gros travaux : jardins', 'تنسيق حدائق'),
  E('65900', '65000', 'Other expenses', 'Autres dépenses', 'نفقات أخرى', 'P'),
  E('67000', null, 'Financial charges', 'Charges financières', 'أعباء مالية'),
  E('67100', '67000', 'Bank service charges', 'Frais bancaires', 'رسوم مصرفية'),
];

/**
 * The lines of the Comptapro FDC (the Jesuit's monthly sheet), by row of a month tab,
 * and the code of the chart each one goes to. Rows 3–5 and 47–49 are the cash part
 * (carried over, from the econome, exchange, given back, kept), not accounts.
 */
export const FDC_ROWS: { row: number; code: string }[] = [
  { row: 8, code: '71100' }, { row: 9, code: '71200' }, { row: 10, code: '71300' }, { row: 11, code: '71400' },
  { row: 12, code: '71600' }, { row: 13, code: '72200' },
  { row: 17, code: '61101' }, { row: 18, code: '61102' }, { row: 19, code: '61201' }, { row: 20, code: '61202' },
  { row: 21, code: '61203' }, { row: 22, code: '61204' }, { row: 23, code: '61301' }, { row: 24, code: '61302' },
  { row: 25, code: '61303' }, { row: 26, code: '61401' }, { row: 27, code: '61405' }, { row: 28, code: '61402' },
  { row: 29, code: '61403' }, { row: 30, code: '61404' }, { row: 31, code: '61500' }, { row: 32, code: '61600' },
  { row: 33, code: '62011' }, { row: 34, code: '62012' }, { row: 35, code: '62051' }, { row: 36, code: '62053' },
  { row: 37, code: '62081' }, { row: 38, code: '62083' }, { row: 39, code: '62101' }, { row: 40, code: '62102' },
  { row: 41, code: '62103' }, { row: 42, code: '62104' }, { row: 43, code: '65200' }, { row: 44, code: '65900' },
];

/** The FDC's month tabs, in the order of the year (October → September). */
export const FDC_MONTHS = ['Oct', 'Nov', 'Déc', 'Jan', 'Fév', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept'];

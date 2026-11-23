import { CHART } from '../community/chart';

// Numbered schema migrations. Same discipline as the Catalogue project:
// a migration that has been applied is NEVER edited — write a new one.
// Each runs once, inside a transaction, and is logged in schema_migration.

export interface Migration {
  n: number;
  name: string;
  sql: string;
}

/** Transfers always have the heading "Transfer" and the line "Transfer" (details go in the explanation). */
export const TRANSFER_SQL = `
INSERT INTO heading (name, code, sort)
  SELECT 'Transfer', 'T01', 90 WHERE NOT EXISTS (SELECT 1 FROM heading WHERE name = 'Transfer' COLLATE NOCASE);
DELETE FROM heading_type WHERE type = 'Transfer' AND heading_id <> (SELECT id FROM heading WHERE name = 'Transfer' COLLATE NOCASE);
DELETE FROM heading_type WHERE heading_id = (SELECT id FROM heading WHERE name = 'Transfer' COLLATE NOCASE) AND type <> 'Transfer';
INSERT OR IGNORE INTO heading_type (heading_id, type) SELECT id, 'Transfer' FROM heading WHERE name = 'Transfer' COLLATE NOCASE;
INSERT INTO budget_line (heading_id, name, code)
  SELECT h.id, 'Transfer', h.code || '.1' FROM heading h WHERE h.name = 'Transfer' COLLATE NOCASE
     AND NOT EXISTS (SELECT 1 FROM budget_line l WHERE l.heading_id = h.id AND l.name = 'Transfer' COLLATE NOCASE);
UPDATE trx SET heading_id = (SELECT id FROM heading WHERE name = 'Transfer' COLLATE NOCASE),
               line_id = (SELECT l.id FROM budget_line l JOIN heading h ON h.id = l.heading_id WHERE h.name = 'Transfer' COLLATE NOCASE AND l.name = 'Transfer' COLLATE NOCASE)
 WHERE type = 'Transfer';
`;

// The Respo book (private, kept by the Superior): the grants in hand and the
// Province's money arrive there, and go to the books by transfers. The Superior's
// own book stays private for his expenses (salaries...).
const RESPO_ID = `(SELECT id FROM book WHERE name = 'Respo' COLLATE NOCASE)`;
// the book where grants arrived until now (the Superior's)
const OLD_GRANTS = `COALESCE((SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'grants_book_id'),
  (SELECT id FROM book WHERE private = 1 AND name <> 'Respo' COLLATE NOCASE ORDER BY id LIMIT 1))`;
// pounds "From the Respo" came from the Superior's own book (Fouad, 2026-10-17); dollars from the Respo
const SUP_BOOK = `COALESCE((SELECT id FROM book WHERE private = 1 AND name <> 'Respo' COLLATE NOCASE ORDER BY id LIMIT 1), ${RESPO_ID})`;
const FROM_BOOK = (syp: string) => `CASE WHEN ${syp} <> 0 THEN ${SUP_BOOK} ELSE ${RESPO_ID} END`;
const TRANSFER_HEADING = `(SELECT id FROM heading WHERE name = 'Transfer' COLLATE NOCASE)`;
const TRANSFER_LINE = `(SELECT l.id FROM budget_line l WHERE l.heading_id = ${TRANSFER_HEADING} AND l.name = 'Transfer' COLLATE NOCASE)`;
const RESPO_LINE = `(SELECT id FROM budget_line WHERE is_project_fund = 1)`;
const INCOME_HEADING = `(SELECT heading_id FROM heading_type WHERE type = 'Income' ORDER BY heading_id LIMIT 1)`;
export const RESPO_SQL = `
INSERT INTO book (name, city_id, account_id, is_main, private, active, sort)
  SELECT 'Respo', (SELECT city_id FROM book WHERE id = ${OLD_GRANTS}), (SELECT account_id FROM book WHERE id = ${OLD_GRANTS}),
         0, 1, 1, (SELECT COALESCE(MAX(sort), 0) + 1 FROM book)
   WHERE NOT EXISTS (SELECT 1 FROM book WHERE name = 'Respo' COLLATE NOCASE);
UPDATE book SET private = 1 WHERE id = ${RESPO_ID};
-- kept by those who keep the Superior's book (or, if none, those who manage users)
INSERT OR IGNORE INTO user_book (profile_id, book_id)
  SELECT p.id, ${RESPO_ID} FROM profile p JOIN access_profile a ON a.id = p.access_id
   WHERE p.active = 1 AND a.perms LIKE '%"users.manage"%';
-- the grants already in hand, and what was transferred from them, move to the Respo book
UPDATE trx SET book_id = ${RESPO_ID} WHERE grant_id IS NOT NULL AND book_id = ${OLD_GRANTS};
INSERT OR REPLACE INTO meta (key, value) VALUES ('grants_book_id', CAST(${RESPO_ID} AS TEXT));
-- a grant in hand whose money was never written in a book: its income in the Respo book
INSERT INTO trx (id, n, city_id, account_id, book_id, date, type, heading_id, line_id, explanation, inc_usd, grant_id, created_at, created_by)
  SELECT 'grant-' || g.id, (SELECT COALESCE(MAX(n), 0) FROM trx) + ROW_NUMBER() OVER (ORDER BY g.hand_on, g.id),
         (SELECT city_id FROM book WHERE id = ${RESPO_ID}),
         COALESCE((SELECT MIN(p.account_id) FROM grant_part p WHERE p.grant_id = g.id HAVING COUNT(DISTINCT p.account_id) = 1 AND COUNT(*) = COUNT(p.account_id)),
                  (SELECT account_id FROM book WHERE id = ${RESPO_ID})),
         ${RESPO_ID}, g.hand_on, 'Income', ${INCOME_HEADING},
         COALESCE((SELECT id FROM budget_line WHERE heading_id = ${INCOME_HEADING} AND active = 1 AND name IN ('Donation', 'Grant') ORDER BY id LIMIT 1),
                  (SELECT id FROM budget_line WHERE heading_id = ${INCOME_HEADING} AND active = 1 AND is_project_fund = 0 ORDER BY id LIMIT 1)),
         'Grant · منحة ' || (SELECT name FROM donor WHERE id = g.donor_id) || COALESCE(' · ' || g.reference, ''),
         g.hand_usd, g.id, COALESCE(g.created_at, datetime('now')), g.created_by
    FROM grant_card g
   WHERE g.status = 'hand' AND g.hand_on IS NOT NULL AND g.hand_usd > 0
     AND NOT EXISTS (SELECT 1 FROM trx t WHERE t.grant_id = g.id AND t.type = 'Income');
-- "From the Respo" incomes become transfers Respo → book (same date and amount).
-- In a book other than Main: two rows, the Respo's (−) and the book's (+).
INSERT INTO trx (id, n, city_id, account_id, book_id, date, type, heading_id, line_id, explanation, inc_syp, exp_syp, inc_usd, exp_usd,
                 trf_syp, trf_usd, transfer_group, received_at, received_by, created_at, created_by, updated_at)
  SELECT 'respo-' || r.id, (SELECT MAX(n) FROM trx) + ROW_NUMBER() OVER (ORDER BY r.date, r.n), r.city_id, r.account_id, ${FROM_BOOK('r.inc_syp')}, r.date,
         'Transfer', ${TRANSFER_HEADING}, ${TRANSFER_LINE}, r.explanation, 0, 0, 0, 0, -r.inc_syp, -r.inc_usd, r.id,
         COALESCE(r.received_at, r.created_at), COALESCE(r.received_by, r.created_by), r.created_at, r.created_by, r.updated_at
    FROM trx r JOIN book b ON b.id = r.book_id
   WHERE r.type = 'Income' AND r.line_id IN ${RESPO_LINE} AND b.is_main = 0 AND (r.inc_syp = 0 OR r.inc_usd = 0);
UPDATE trx SET type = 'Transfer', heading_id = ${TRANSFER_HEADING}, line_id = ${TRANSFER_LINE}, trf_syp = inc_syp, trf_usd = inc_usd,
               inc_syp = 0, inc_usd = 0, transfer_group = id, received_at = COALESCE(received_at, created_at), received_by = COALESCE(received_by, created_by)
 WHERE type = 'Income' AND line_id IN ${RESPO_LINE} AND (inc_syp = 0 OR inc_usd = 0)
   AND book_id IN (SELECT id FROM book WHERE is_main = 0);
-- In Main: one row, on the giver's book (Main's side is implicit).
UPDATE trx SET type = 'Transfer', book_id = ${FROM_BOOK('inc_syp')}, heading_id = ${TRANSFER_HEADING}, line_id = ${TRANSFER_LINE},
               trf_syp = -inc_syp, trf_usd = -inc_usd, inc_syp = 0, inc_usd = 0,
               received_at = COALESCE(received_at, created_at), received_by = COALESCE(received_by, created_by)
 WHERE type = 'Income' AND line_id IN ${RESPO_LINE} AND (inc_syp = 0 OR inc_usd = 0)
   AND book_id IN (SELECT id FROM book WHERE is_main = 1);
UPDATE meta SET value = CAST(MAX(CAST(value AS INTEGER), (SELECT COALESCE(MAX(n), 0) FROM trx)) AS TEXT) WHERE key = 'last_n';
UPDATE budget_line SET active = 0 WHERE is_project_fund = 1
   AND NOT EXISTS (SELECT 1 FROM trx WHERE line_id = budget_line.id);
-- the Province's money (without a donor): an income in the Respo book
INSERT INTO budget_line (heading_id, name, code)
  SELECT h.id, 'From the Province',
         h.code || '.' || (SELECT COALESCE(MAX(CAST(substr(l.code, length(h.code) + 2) AS INTEGER)), 0) + 1 FROM budget_line l WHERE l.heading_id = h.id)
    FROM heading h WHERE h.id = ${INCOME_HEADING}
     AND NOT EXISTS (SELECT 1 FROM budget_line l WHERE l.heading_id = h.id AND l.name = 'From the Province' COLLATE NOCASE);
-- the Funding report, for those who manage users (the Superior)
UPDATE access_profile SET perms = replace(perms, ']', ',"reports.funding"]')
 WHERE perms LIKE '%"users.manage"%' AND perms NOT LIKE '%"reports.funding"%';
`;

/** The starting chart, as plain inserts, for a country database that has none (migration 19). */
const q = (x: string | null | undefined) => (x == null ? 'NULL' : `'${x.replace(/'/g, "''")}'`);
const COUNTRY_CHART_SQL = CHART.map((a, i) => `INSERT INTO cty_account (uid, code, parent_id, type, name_en, name_fr, name_ar, scope, claim, sort)
  SELECT ${q('c' + a.code)}, ${q(a.code)}, (SELECT id FROM cty_account WHERE code = ${q(a.parent)}), ${q(a.type)}, ${q(a.en)}, ${q(a.fr)}, ${q(a.ar)}, ${q(a.scope)}, ${q(a.claim)}, ${i + 1}
   WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'kind' AND value = 'country') AND NOT EXISTS (SELECT 1 FROM cty_account WHERE uid = ${q('c' + a.code)});`).join('\n');

export const MIGRATIONS: Migration[] = [
  {
    n: 1,
    name: 'initial schema',
    sql: `
-- Key/value facts about this database file: what kind of install it is,
-- the holder's book on a holder install, list version, organisation name.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Settings block of the Data sheet (USD_Rate, Def_City, Def_Account, Def_Book…).
CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ===== Reference lists. Never hard-delete a value already used: deactivate it. =====
CREATE TABLE city (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE project (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);

-- An account = a funded project (Center→Magis, harat→UNDP, Deir→Deir…).
CREATE TABLE account (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);

-- "Main" is the main fund; every other book is the cash one keeper holds.
-- city_id / account_id are the defaults offered on that keeper's new rows
-- (the BOOK KEEPERS block of the Data sheet).
CREATE TABLE book (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  keeper_name TEXT,
  city_id     INTEGER REFERENCES city(id),
  account_id  INTEGER REFERENCES account(id),
  is_main     INTEGER NOT NULL DEFAULT 0,
  opening_syp REAL NOT NULL DEFAULT 0,
  opening_usd REAL NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE party (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);

-- Budget sheet, table Headings (Budget Heading, Code).
CREATE TABLE heading (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  code   TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);

-- Budget sheet, table HeadingTypes: which heading is offered for which type.
-- Many-to-many: "Other / Unallocated" serves both Exp and Transfer.
CREATE TABLE heading_type (
  heading_id INTEGER NOT NULL REFERENCES heading(id),
  type       TEXT NOT NULL CHECK (type IN ('Income','Exp','Transfer','Exchange')),
  PRIMARY KEY (heading_id, type)
);

-- Budget sheet, table Budget2027 (Heading, Line). The code is given once and
-- never renumbered, so old rows keep their code when a line is added.
-- is_project_fund = the DonationLines table ("From the Respo").
CREATE TABLE budget_line (
  id              INTEGER PRIMARY KEY,
  heading_id      INTEGER NOT NULL REFERENCES heading(id),
  name            TEXT NOT NULL COLLATE NOCASE,
  code            TEXT NOT NULL UNIQUE,
  is_project_fund INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  UNIQUE (heading_id, name)
);

CREATE TABLE donor (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  default_project_id INTEGER REFERENCES project(id),
  active             INTEGER NOT NULL DEFAULT 1,
  sort               INTEGER NOT NULL DEFAULT 0
);

-- ProjectMap: which expenses belong to which project.
-- heading_id NULL = "All" (every expense of that account).
-- A named heading takes priority over All for the same account.
CREATE TABLE project_rule (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project(id),
  account_id INTEGER NOT NULL REFERENCES account(id),
  heading_id INTEGER REFERENCES heading(id),
  UNIQUE (account_id, heading_id)
);

-- ===== The register (Table TRX). Only input columns are stored;
-- Rate, USD totals, Code, Bill_Code, Month, Year are always computed. =====
CREATE TABLE trx (
  id          TEXT PRIMARY KEY,            -- Entry_ID (UUID), travels with the row
  n           INTEGER UNIQUE,              -- 0001… given by the office database
  city_id     INTEGER REFERENCES city(id),
  account_id  INTEGER REFERENCES account(id),
  book_id     INTEGER REFERENCES book(id),
  date        TEXT,                        -- YYYY-MM-DD; NULL only on migrated rows under review
  type        TEXT CHECK (type IS NULL OR type IN ('Income','Exp','Transfer','Exchange')),
  heading_id  INTEGER REFERENCES heading(id),
  line_id     INTEGER REFERENCES budget_line(id),
  explanation TEXT,
  party_id    INTEGER REFERENCES party(id),
  receipt     TEXT,
  inc_syp     REAL NOT NULL DEFAULT 0,
  exp_syp     REAL NOT NULL DEFAULT 0,
  inc_usd     REAL NOT NULL DEFAULT 0,
  exp_usd     REAL NOT NULL DEFAULT 0,
  trf_syp     REAL NOT NULL DEFAULT 0,
  trf_usd     REAL NOT NULL DEFAULT 0,
  transfer_group TEXT,                     -- links the two rows of a keeper-to-keeper transfer
  review      TEXT,                        -- why a migrated/imported row needs checking; NULL = clean
  sent_at     TEXT,                        -- holder install: when this row left in an entries file
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT,
  source_file TEXT
);
CREATE INDEX trx_date ON trx(date);
CREATE INDEX trx_book ON trx(book_id);

-- Grants received by the Respo (Donors sheet, table A). One row per project.
CREATE TABLE grant_row (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  donor_id   INTEGER NOT NULL REFERENCES donor(id),
  project_id INTEGER REFERENCES project(id),
  amount_usd REAL NOT NULL,
  reference  TEXT,
  note       TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

-- Holder install only: what the office handed me (Book sheet, table ①).
-- For the holder's own follow-up; never exported — the office books transfers.
CREATE TABLE holder_receipt (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  amount_syp REAL NOT NULL DEFAULT 0,
  amount_usd REAL NOT NULL DEFAULT 0,
  receipt    TEXT,
  note       TEXT,
  created_at TEXT NOT NULL
);

-- Note-by-note cash count (Holders section 4), one row per book × currency × note.
CREATE TABLE cash_count (
  book_id     INTEGER NOT NULL REFERENCES book(id),
  currency    TEXT NOT NULL CHECK (currency IN ('SYP','USD')),
  denomination REAL NOT NULL,
  qty         INTEGER NOT NULL DEFAULT 0,
  counted_at  TEXT,
  PRIMARY KEY (book_id, currency, denomination)
);

CREATE TABLE closed_month (
  ym        TEXT PRIMARY KEY,              -- YYYY-MM
  closed_at TEXT NOT NULL,
  closed_by TEXT
);

-- Who may open this database. PIN is stored salted + hashed.
CREATE TABLE profile (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  role     TEXT NOT NULL CHECK (role IN ('sup','com','holder')),
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  book_id  INTEGER REFERENCES book(id),
  active   INTEGER NOT NULL DEFAULT 1
);

-- Every edit and delete: who, when, before/after.
CREATE TABLE audit_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,
  who       TEXT,
  action    TEXT NOT NULL,
  tbl       TEXT NOT NULL,
  row_id    TEXT,
  before    TEXT,
  after     TEXT
);

-- Entries files already imported (keeper → office).
CREATE TABLE import_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,
  who       TEXT,
  kind      TEXT NOT NULL,
  file_name TEXT,
  added     INTEGER NOT NULL DEFAULT 0,
  skipped   INTEGER NOT NULL DEFAULT 0,
  detail    TEXT
);
`,
  },
  {
    n: 2,
    name: 'permission profiles, books per user, transfer confirmation, two-step month closing',
    sql: `
-- Permission profiles: named sets of ticks (see src/perms.ts for their meaning).
-- The three first ones copy the old fixed roles; the Superior can change them.
CREATE TABLE access_profile (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  perms TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO access_profile (id, name, perms, sort) VALUES
  (1, 'Superior · الرئيس', '["book.own","register.view","register.edit","reports.summary","reports.monthly","reports.accounts","reports.exchange","reports.cash","reports.coverage","reports.funds","lists.manage","lists.donors","month.close","month.reopen","users.manage","data.backup","data.restore","data.export","data.import","audit.view"]', 1),
  (2, 'Accountant · المحاسب', '["book.own","register.view","register.edit","reports.summary","reports.monthly","reports.accounts","reports.exchange","reports.cash","lists.manage","month.close","data.backup","data.export","data.import","audit.view"]', 2),
  (3, 'Book holder · أمين صندوق', '["book.own","reports.summary","reports.monthly"]', 3);

ALTER TABLE profile ADD COLUMN access_id INTEGER REFERENCES access_profile(id);
UPDATE profile SET access_id = CASE role WHEN 'sup' THEN 1 WHEN 'com' THEN 2 ELSE 3 END;

-- The books a person keeps (none, one or several).
CREATE TABLE user_book (
  profile_id INTEGER NOT NULL REFERENCES profile(id),
  book_id    INTEGER NOT NULL REFERENCES book(id),
  PRIMARY KEY (profile_id, book_id)
);
INSERT INTO user_book (profile_id, book_id) SELECT id, book_id FROM profile WHERE book_id IS NOT NULL;

-- A transfer is recorded once by the giver; the receiver confirms it.
ALTER TABLE trx ADD COLUMN received_at TEXT;
ALTER TABLE trx ADD COLUMN received_by TEXT;
ALTER TABLE trx ADD COLUMN disputed_at TEXT;
ALTER TABLE trx ADD COLUMN dispute_note TEXT;
-- transfers already in the register are history: taken as received
UPDATE trx SET received_at = created_at, received_by = 'migration' WHERE type = 'Transfer';

-- Step 1 of month closing: the holder closes his book's month.
-- (Step 2, the office, is the closed_month table.)
CREATE TABLE book_month (
  book_id   INTEGER NOT NULL REFERENCES book(id),
  ym        TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  closed_by TEXT,
  PRIMARY KEY (book_id, ym)
);
`,
  },
  {
    n: 3,
    name: 'first-login password change, Arabic-first profile names',
    sql: `
-- 1 = the person must choose his own password at the next login
-- (accounts created by the Superior, or a password reset by him).
ALTER TABLE profile ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0;
-- Arabic first, like every label of the program (only if never renamed).
UPDATE access_profile SET name = 'الرئيس · Superior' WHERE name = 'Superior · الرئيس';
UPDATE access_profile SET name = 'المحاسب · Accountant' WHERE name = 'Accountant · المحاسب';
UPDATE access_profile SET name = 'أمين صندوق · Book holder' WHERE name = 'Book holder · أمين صندوق';
`,
  },
  {
    n: 4,
    name: 'attached documents (scans, PDFs, photos) per register row',
    sql: `
-- One row per attached document. The file itself is stored on disk next to the
-- database (attachments folder), named after the row's Bill_Code; this table keeps
-- what it is and who added it. Nothing is ever deleted: a removed document is only
-- marked (deleted_at), so the audit can always show it. No foreign key on trx_id:
-- a deleted register row keeps its documents for the record.
CREATE TABLE attachment (
  id         TEXT PRIMARY KEY,
  trx_id     TEXT NOT NULL,
  file       TEXT NOT NULL,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT,
  deleted_by TEXT
);
CREATE INDEX attachment_trx ON attachment(trx_id);
`,
  },
  {
    n: 5,
    name: 'the Accountant writes in the Main book only (sees every book)',
    sql: `
-- Superior: every book. Accountant: sees every book, writes only in Main.
-- Book holder: his own book only. A renamed or hand-made profile is left alone.
UPDATE access_profile SET perms = replace(perms, '"register.edit"', '"register.main"')
 WHERE id = 2 AND name = 'المحاسب · Accountant';
`,
  },
  {
    n: 6,
    name: 'yearly budget: items (quantity × times × cost) per account and line, contingency, revisions, donors',
    sql: `
-- One budget per year. rev 0 is the original; a revision copies the latest one
-- and becomes the current budget, the original stays as it was.
-- start_month/months: the period it covers (e.g. 2026: July, 6 months).
CREATE TABLE budget_version (
  id          INTEGER PRIMARY KEY,
  year        INTEGER NOT NULL,
  rev         INTEGER NOT NULL,
  rate_syp    REAL NOT NULL,
  rate_eur    REAL NOT NULL,
  start_month INTEGER NOT NULL DEFAULT 1 CHECK (start_month BETWEEN 1 AND 12),
  months      INTEGER NOT NULL DEFAULT 12 CHECK (months BETWEEN 1 AND 12),
  note        TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  UNIQUE (year, rev)
);
-- The amount of each line, in USD, per account. When the line has items, it is
-- their total (kept here by the program); otherwise it is typed directly.
CREATE TABLE budget_amount (
  version_id INTEGER NOT NULL REFERENCES budget_version(id),
  account_id INTEGER NOT NULL REFERENCES account(id),
  line_id    INTEGER NOT NULL REFERENCES budget_line(id),
  amount_usd REAL NOT NULL,
  PRIMARY KEY (version_id, account_id, line_id)
);
-- How a line is built: Quantity × Times (months it runs; staff 13) × Cost per unit.
CREATE TABLE budget_item (
  id         INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES budget_version(id),
  account_id INTEGER NOT NULL REFERENCES account(id),
  line_id    INTEGER NOT NULL REFERENCES budget_line(id),
  name       TEXT NOT NULL,
  unit       TEXT,
  qty        REAL NOT NULL,
  times      REAL NOT NULL,
  unit_cost  REAL NOT NULL,
  note       TEXT,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX budget_item_cell ON budget_item(version_id, account_id, line_id);
-- Per account: the contingency added on top (e.g. 10 % on running costs, 0 on furniture),
-- and, for an account kept for one donor (e.g. Harat, UNDP), one amount for all its
-- spending whatever the line (then the account has no line amounts).
CREATE TABLE budget_account (
  version_id      INTEGER NOT NULL REFERENCES budget_version(id),
  account_id      INTEGER NOT NULL REFERENCES account(id),
  contingency_pct REAL NOT NULL DEFAULT 0,
  lump_usd        REAL CHECK (lump_usd IS NULL OR lump_usd > 0),
  PRIMARY KEY (version_id, account_id)
);
-- A donor covers a part: a percentage, a fixed amount, or "the rest" (what no
-- other donor covers), of an account (null: every account of the centre), of a
-- heading in it, or of one line.
CREATE TABLE budget_alloc (
  id         INTEGER PRIMARY KEY,
  year       INTEGER NOT NULL,
  donor_id   INTEGER NOT NULL REFERENCES donor(id),
  account_id INTEGER REFERENCES account(id),
  heading_id INTEGER REFERENCES heading(id),
  line_id    INTEGER REFERENCES budget_line(id),
  pct        REAL CHECK (pct IS NULL OR (pct > 0 AND pct <= 100)),
  amount_usd REAL CHECK (amount_usd IS NULL OR amount_usd > 0),
  rest       INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL CHECK (status IN ('requested','promised','received')),
  note       TEXT,
  CHECK ((pct IS NOT NULL) + (amount_usd IS NOT NULL) + (rest = 1) = 1)
);
CREATE INDEX budget_alloc_year ON budget_alloc(year);
-- SJ: the Society of Jesus, who covers what no other donor covers.
INSERT INTO donor (name) SELECT 'SJ' WHERE NOT EXISTS (SELECT 1 FROM donor WHERE name = 'SJ' COLLATE NOCASE);
-- An account outside the centre (e.g. Deir): recorded, but not part of its budget.
ALTER TABLE account ADD COLUMN outside_budget INTEGER NOT NULL DEFAULT 0;
-- For now the budget is the Superior's only (those who manage users);
-- it can be given to others by ticking it in their permission profile.
UPDATE access_profile SET perms = replace(perms, ']', ',"budget.view","budget.manage"]')
 WHERE perms LIKE '%"users.manage"%';
`,
  },
  {
    n: 7,
    name: 'controls: approval of large expenses, cash count at book closing, closed years',
    sql: `
-- A large expense waits for approval (rule and amount in the settings).
ALTER TABLE trx ADD COLUMN approved_at TEXT;
ALTER TABLE trx ADD COLUMN approved_by TEXT;
-- Closing a book's month: the cash counted, what the book says, and why they differ.
ALTER TABLE book_month ADD COLUMN book_syp REAL;
ALTER TABLE book_month ADD COLUMN book_usd REAL;
ALTER TABLE book_month ADD COLUMN counted_syp REAL;
ALTER TABLE book_month ADD COLUMN counted_usd REAL;
ALTER TABLE book_month ADD COLUMN count_note TEXT;
-- The document rule ($50 by default) applies to what is entered from today on.
INSERT OR REPLACE INTO setting (key, value) VALUES ('doc_since', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
-- A year closed once its twelve months are closed (only the Superior reopens).
CREATE TABLE closed_year (
  year      INTEGER PRIMARY KEY,
  closed_at TEXT NOT NULL,
  closed_by TEXT
);
`,
  },
  {
    n: 8,
    name: 'budgets with their own period (start month, 1-36 months), may overlap, leftover carried over',
    sql: `
-- A budget: a name (by default its dates), a period, and the budget it continues.
-- The budgets made before keep their number: the year (2026, 2027).
CREATE TABLE budget (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  start_ym      TEXT NOT NULL,
  months        INTEGER NOT NULL CHECK (months BETWEEN 1 AND 36),
  carry_from_id INTEGER REFERENCES budget(id),
  created_at    TEXT NOT NULL,
  created_by    TEXT
);
INSERT INTO budget (id, name, start_ym, months, carry_from_id, created_at, created_by)
  SELECT year,
         CASE WHEN start_month = 1 AND months = 12 THEN CAST(year AS TEXT)
              ELSE substr('JanFebMarAprMayJunJulAugSepOctNovDec', (start_month - 1) * 3 + 1, 3) || ' ' || year || ' – ' ||
                   substr('JanFebMarAprMayJunJulAugSepOctNovDec', (start_month + months - 2) * 3 + 1, 3) || ' ' || year END,
         printf('%d-%02d', year, start_month), months, NULL, created_at, created_by
    FROM budget_version WHERE rev = 0;
-- Versions and donor allocations now point at their budget. (In budget_version,
-- the old "year" column holds the budget's number, so (year, rev) stays unique.)
ALTER TABLE budget_version ADD COLUMN budget_id INTEGER REFERENCES budget(id);
UPDATE budget_version SET budget_id = year;
ALTER TABLE budget_alloc ADD COLUMN budget_id INTEGER REFERENCES budget(id);
UPDATE budget_alloc SET budget_id = year WHERE year IN (SELECT id FROM budget);
`,
  },
  {
    n: 9,
    name: 'grants follow the money (promised to in hand), for accounts; private books; no more projects',
    sql: `
-- A book only its keepers see (the Superior's book): others see only the transfers it makes.
ALTER TABLE book ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
UPDATE book SET private = 1
 WHERE is_main = 0 AND id IN (SELECT ub.book_id FROM user_book ub JOIN profile p ON p.id = ub.profile_id
                              JOIN access_profile a ON a.id = p.access_id WHERE p.active = 1 AND a.perms LIKE '%"users.manage"%');
-- A grant follows the money: promised, approved, transferred by the donor, in the bank,
-- in hand (then it is an income in the Superior's book). USD or EUR.
CREATE TABLE grant_card (
  id             TEXT PRIMARY KEY,
  donor_id       INTEGER NOT NULL REFERENCES donor(id),
  amount         REAL NOT NULL CHECK (amount > 0),
  currency       TEXT NOT NULL CHECK (currency IN ('USD','EUR')),
  reference      TEXT,
  note           TEXT,
  status         TEXT NOT NULL CHECK (status IN ('promised','approved','transferred','bank','hand')),
  promised_on    TEXT,
  approved_on    TEXT,
  transferred_on TEXT,
  bank_on        TEXT,
  hand_on        TEXT,
  hand_usd       REAL,
  created_at     TEXT NOT NULL,
  created_by     TEXT
);
-- What a grant is for: one or several accounts (amounts in the grant's currency), or the whole centre (NULL).
CREATE TABLE grant_part (
  grant_id   TEXT NOT NULL REFERENCES grant_card(id),
  account_id INTEGER REFERENCES account(id),
  amount     REAL NOT NULL CHECK (amount > 0)
);
CREATE INDEX grant_part_grant ON grant_part(grant_id);
-- The income in the Superior's book, and the transfers from it, say which grant they move.
ALTER TABLE trx ADD COLUMN grant_id TEXT;
-- The grants recorded before: in hand, for the account of their project (or the whole centre).
INSERT INTO grant_card (id, donor_id, amount, currency, reference, note, status, hand_on, hand_usd, created_at, created_by)
  SELECT id, donor_id, amount_usd, 'USD', reference, note, 'hand', date, amount_usd, created_at, created_by
    FROM grant_row WHERE amount_usd > 0;
INSERT INTO grant_part (grant_id, account_id, amount)
  SELECT g.id,
         CASE WHEN (SELECT COUNT(DISTINCT r.account_id) FROM project_rule r WHERE r.project_id = g.project_id) = 1
              THEN (SELECT r.account_id FROM project_rule r WHERE r.project_id = g.project_id LIMIT 1) END,
         g.amount_usd
    FROM grant_row g WHERE g.amount_usd > 0;
`,
  },
  {
    n: 10,
    name: 'transfers always under the heading and line "Transfer"',
    sql: TRANSFER_SQL,
  },
  {
    n: 11,
    name: 'the Respo book: grants and the Province money arrive there, and go to the books by transfers',
    sql: RESPO_SQL,
  },
  {
    n: 12,
    name: 'community databases (Jesuit communities): chart of codes, entries in three currencies, month closing',
    sql: `
-- Used only by a database of kind "community" (meta kind = community). In a MAGIS
-- centre these tables stay empty and nothing else changes.

-- The chart of codes: family (61000) > heading (61400) > line (61402).
-- An entry points to the row, not to the number, so a code can be changed later.
CREATE TABLE cty_account (
  id        INTEGER PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES cty_account(id),
  type      TEXT NOT NULL CHECK (type IN ('Income','Exp')),
  name_en   TEXT NOT NULL,
  name_fr   TEXT NOT NULL,
  name_ar   TEXT NOT NULL,
  scope     TEXT NOT NULL DEFAULT 'H' CHECK (scope IN ('P','H')),
  claim     TEXT CHECK (claim IN ('health','scholastic','provincial','other')),
  active    INTEGER NOT NULL DEFAULT 1,
  sort      INTEGER NOT NULL DEFAULT 0
);

-- What a book is in a community: a Jesuit's personal book, the house book (held
-- by the Minister), or the econome's cash, bank and account at the economat.
ALTER TABLE book ADD COLUMN cty_kind TEXT;
ALTER TABLE book ADD COLUMN opening_eur REAL NOT NULL DEFAULT 0;

-- One entry = one amount in one currency (LOC = the local currency, USD, EUR),
-- always positive: the type says whether it comes in or goes out.
--  Income / Exp: on book_id, with its account.
--  Transfer: from book_id to to_book_id (the giver records it, the receiver confirms).
--  Exchange: on book_id, gives amount in cur and receives amount2 in cur2.
CREATE TABLE cty_entry (
  id           TEXT PRIMARY KEY,
  n            INTEGER UNIQUE,
  book_id      INTEGER NOT NULL REFERENCES book(id),
  date         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('Income','Exp','Transfer','Exchange')),
  account_id   INTEGER REFERENCES cty_account(id),
  cur          TEXT NOT NULL CHECK (cur IN ('LOC','USD','EUR')),
  amount       REAL NOT NULL CHECK (amount > 0),
  cur2         TEXT CHECK (cur2 IN ('LOC','USD','EUR')),
  amount2      REAL,
  to_book_id   INTEGER REFERENCES book(id),
  note         TEXT,
  claim        TEXT CHECK (claim IN ('health','scholastic','provincial','other')),
  claim_note   TEXT,
  received_at  TEXT,
  received_by  TEXT,
  disputed_at  TEXT,
  dispute_note TEXT,
  source       TEXT UNIQUE,
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  updated_at   TEXT
);
CREATE INDEX cty_entry_book ON cty_entry(book_id, date);
CREATE INDEX cty_entry_to ON cty_entry(to_book_id, date);

-- A book's month, closed by its keeper after counting his cash in each currency.
-- seen_at / seen_by: the Superior's reading of the month.
CREATE TABLE cty_month (
  book_id     INTEGER NOT NULL REFERENCES book(id),
  ym          TEXT NOT NULL,
  closed_at   TEXT NOT NULL,
  closed_by   TEXT,
  book_loc    REAL, book_usd REAL, book_eur REAL,
  counted_loc REAL, counted_usd REAL, counted_eur REAL,
  count_note  TEXT,
  seen_at     TEXT,
  seen_by     TEXT,
  PRIMARY KEY (book_id, ym)
);
`,
  },
  {
    n: 13,
    name: "community: the Superior's approval above a limit, his private notes",
    sql: `
-- An expense worth at least the limit (in dollars, set by the econome, one for the house
-- book and one for the personal books) waits for the Superior's approval. Whether it needs
-- it is decided when it is saved, so a later change of the limit never touches the past.
ALTER TABLE cty_entry ADD COLUMN approval_needed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cty_entry ADD COLUMN approval_usd REAL;
ALTER TABLE cty_entry ADD COLUMN approved_at TEXT;
ALTER TABLE cty_entry ADD COLUMN approved_by TEXT;

-- The Superior's questions and comments, on an entry or on a month of a book, and
-- the answers. PRIVATE: only the Jesuit who keeps the book and the Superior see them
-- (Fouad, 18 October 2026), not the econome.
CREATE TABLE cty_note (
  id         TEXT PRIMARY KEY,
  book_id    INTEGER NOT NULL REFERENCES book(id),
  ym         TEXT,
  entry_id   TEXT,
  parent_id  TEXT,
  author_id  INTEGER REFERENCES profile(id),
  author     TEXT,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX cty_note_book ON cty_note(book_id);

-- the econome sets the limits
UPDATE access_profile SET perms = replace(perms, ']', ',"cty.limits"]')
 WHERE perms LIKE '%"cty.write_all"%' AND perms NOT LIKE '%"cty.limits"%';
`,
  },
  {
    n: 14,
    name: 'country databases: monthly files from the communities, claims decided, charges between communities, account at the economat',
    sql: `
-- ---- In a community database ----
-- The decision of the country econome on a claimed expense (brought back by the return file).
ALTER TABLE cty_entry ADD COLUMN claim_status TEXT;
ALTER TABLE cty_entry ADD COLUMN claim_accepted REAL;
ALTER TABLE cty_entry ADD COLUMN claim_decision_note TEXT;
-- The community's account at the economat as the country econome keeps it (replaced at each return file).
CREATE TABLE cty_statement (
  id     TEXT PRIMARY KEY,
  date   TEXT NOT NULL,
  kind   TEXT NOT NULL,
  note   TEXT,
  cur    TEXT NOT NULL,
  amount REAL NOT NULL
);

-- ---- In a country database (meta kind = country) ----
-- The communities, known by the identity written in their files.
CREATE TABLE country_cty (
  id     INTEGER PRIMARY KEY,
  uid    TEXT NOT NULL UNIQUE,
  name   TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
-- One month of one community, as its file brought it: totals by code, never a Jesuit's detail.
CREATE TABLE country_month (
  cty_id      INTEGER NOT NULL REFERENCES country_cty(id),
  ym          TEXT NOT NULL,
  hash        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  received_at TEXT NOT NULL,
  received_by TEXT,
  PRIMARY KEY (cty_id, ym)
);
-- The expenses a community claims from the Province, and the decision.
CREATE TABLE country_claim (
  id          TEXT PRIMARY KEY,
  cty_id      INTEGER NOT NULL REFERENCES country_cty(id),
  date        TEXT NOT NULL,
  code        TEXT,
  line        TEXT,
  book_kind   TEXT,
  cur         TEXT NOT NULL,
  amount      REAL NOT NULL,
  reason      TEXT,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','accepted','refused','withdrawn')),
  accepted    REAL,
  decision_note TEXT,
  decided_at  TEXT,
  decided_by  TEXT
);
-- Charges between communities: the host community (credited) charges another (debited),
-- e.g. three nights in Beirut for a Jesuit of Homs. Recorded by the country econome.
CREATE TABLE country_charge (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  host_id    INTEGER NOT NULL REFERENCES country_cty(id),
  charged_id INTEGER NOT NULL REFERENCES country_cty(id),
  cur        TEXT NOT NULL,
  amount     REAL NOT NULL CHECK (amount > 0),
  note       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);
-- Other movements on a community's account at the economat: what it paid, what it
-- received, cotisations… amount > 0 = in the community's favour, < 0 = it owes.
CREATE TABLE country_move (
  id         TEXT PRIMARY KEY,
  cty_id     INTEGER NOT NULL REFERENCES country_cty(id),
  date       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('paid_by_cty','paid_to_cty','cotisation','other')),
  cur        TEXT NOT NULL,
  amount     REAL NOT NULL,
  note       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);
`,
  },
  {
    n: 15,
    name: 'claims carry the name of the Jesuit; the host community marks charges to another community, the country econome approves',
    sql: `
-- The name of the Jesuit on a claim: the country econome checks it (Fouad, 18 October 2026: "easier to check, especially health").
ALTER TABLE country_claim ADD COLUMN person TEXT;

-- In a community: what it charges another community (e.g. a Jesuit of Homs stayed 3 nights here).
-- It travels in the monthly file; the country econome approves or refuses.
CREATE TABLE cty_charge (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  to_uid        TEXT,
  to_name       TEXT NOT NULL,
  person        TEXT,
  cur           TEXT NOT NULL,
  amount        REAL NOT NULL CHECK (amount > 0),
  note          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'waiting',
  decision_note TEXT,
  created_at    TEXT NOT NULL,
  created_by    TEXT
);
-- The other communities of the country (from the return file), to choose from.
CREATE TABLE cty_known (
  uid  TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- In the country database: the charges proposed by host communities, waiting for approval.
CREATE TABLE country_proposal (
  id            TEXT PRIMARY KEY,
  host_id       INTEGER NOT NULL REFERENCES country_cty(id),
  date          TEXT NOT NULL,
  charged_uid   TEXT,
  charged_name  TEXT NOT NULL,
  person        TEXT,
  cur           TEXT NOT NULL,
  amount        REAL NOT NULL,
  note          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','approved','refused','withdrawn')),
  decision_note TEXT,
  decided_at    TEXT,
  decided_by    TEXT
);
`,
  },
  {
    n: 16,
    name: 'chart of codes kept by the country (stable identity per line); a personal bank book',
    sql: `
-- Each line of the chart keeps one identity everywhere (country and communities), whatever
-- its code becomes. The chart is kept by the country econome (later the Province) and sent
-- to the communities in the return file (Fouad, 18 October 2026).
ALTER TABLE cty_account ADD COLUMN uid TEXT;
UPDATE cty_account SET uid = 'c' || code WHERE uid IS NULL;
CREATE UNIQUE INDEX cty_account_uid ON cty_account(uid);
-- the econome no longer changes the chart in a community
UPDATE access_profile SET perms = replace(replace(perms, ',"cty.chart"', ''), '"cty.chart",', '') WHERE perms LIKE '%"cty.chart"%';
`,
  },
  {
    n: 17,
    name: 'community: roles that change during the year, optional bank, closing by quarter, banknotes counted',
    sql: `
-- The roles of each person in a community (superior, econome, minister): the Superior changes
-- them during the year (Fouad, 18 October 2026: "a Jesuit becomes econome instead of another").
ALTER TABLE profile ADD COLUMN cty_roles TEXT;
-- The banknotes counted at closing, currency by currency ({"LOC": {"500": 3, …}, …}).
ALTER TABLE cty_month ADD COLUMN count_detail TEXT;
`,
  },
  {
    n: 18,
    name: 'community: the roles of people created before roles were stored, read from their profile',
    sql: `
UPDATE profile SET cty_roles = (
  SELECT '[' || trim(
    (CASE WHEN a.name LIKE '%Superior%' THEN '"superior",' ELSE '' END) ||
    (CASE WHEN a.name LIKE '%Econome%' THEN '"econome",' ELSE '' END) ||
    (CASE WHEN a.name LIKE '%Minister%' THEN '"minister",' ELSE '' END), ',') || ']'
  FROM access_profile a WHERE a.id = profile.access_id)
 WHERE cty_roles IS NULL AND EXISTS (SELECT 1 FROM meta WHERE key = 'kind' AND value = 'community');
`,
  },
  {
    n: 19,
    name: 'older test databases: the chart in a country database, the bank only if used, Arabic role names',
    sql: `
-- a country database made before the country kept the chart: it gets the chart
${COUNTRY_CHART_SQL}
-- a community with no bank setting: the bank stays only if something was written in it
INSERT INTO setting (key, value)
  SELECT 'cty_has_bank', CASE WHEN EXISTS (SELECT 1 FROM cty_entry e JOIN book b ON b.id IN (e.book_id, e.to_book_id) WHERE b.cty_kind = 'bank') THEN '1' ELSE '0' END
   WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'kind' AND value = 'community')
     AND NOT EXISTS (SELECT 1 FROM setting WHERE key = 'cty_has_bank');
UPDATE book SET active = 0 WHERE cty_kind = 'bank' AND EXISTS (SELECT 1 FROM setting WHERE key = 'cty_has_bank' AND value = '0');
DELETE FROM user_book WHERE book_id IN (SELECT id FROM book WHERE cty_kind = 'bank' AND active = 0);
-- the Arabic names of the roles (minister = المدبّر, econome = القيّم)
UPDATE access_profile SET name = replace(replace(replace(name, 'المدبّر · Econome', 'القيّم · Econome'), 'الوزير · Minister', 'المدبّر · Minister'), 'مدبّر البلد', 'قيّم البلد');
`,
  },
  {
    n: 20,
    name: 'Arabic role names without extra marks: القيم (econome), المدبر (minister), قيم البلد (country econome)',
    sql: `
UPDATE access_profile SET name = replace(replace(replace(replace(name, 'القيّم', 'القيم'), 'المدبّر', 'المدبر'), 'قيّم البلد', 'قيم البلد'), 'مدبّر البلد', 'قيم البلد');
`,
  },
  {
    n: 21,
    name: 'community offices: Superior, Econome, Minister and Administrator are accounts of their own; an expense can be refused',
    sql: `
-- A person (a Jesuit) and an OFFICE are different accounts (Fouad, 19 October 2026). An office
-- (superior | econome | minister | admin) has its own password and keeps its own books; it is
-- held by a person (held_by), changed when the office is handed over.
ALTER TABLE profile ADD COLUMN cty_office TEXT;
ALTER TABLE profile ADD COLUMN held_by TEXT;
-- The Superior may refuse an expense: it stays recorded, flagged with his reason.
ALTER TABLE cty_entry ADD COLUMN refused_at TEXT;
ALTER TABLE cty_entry ADD COLUMN refused_by TEXT;
ALTER TABLE cty_entry ADD COLUMN refused_note TEXT;
`,
  },
  {
    n: 22,
    name: 'movements on the account at the économat have a state: promised, on the way, received',
    sql: `
-- Money between the Province and a community (a grant, a payment, a cotisation) goes through
-- states, as the grants of MAGIS do: promised → on the way → received. Only what is received
-- counts in the balance; the rest is shown as expected. (Fouad, 19 October 2026)
ALTER TABLE country_move ADD COLUMN status TEXT NOT NULL DEFAULT 'received';
ALTER TABLE cty_statement ADD COLUMN status TEXT NOT NULL DEFAULT 'received';
`,
  },
  {
    n: 23,
    name: "the community's own side of the money with the Province",
    sql: `
-- What the community itself records of the money between it and the Province (a grant received,
-- a payment, a cotisation), with the same states. It goes to the country econome in the monthly
-- file, who compares it with his side. (Fouad, 19 October 2026: "both sides must enter")
CREATE TABLE cty_province (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('paid_by_cty','paid_to_cty','cotisation','other')),
  cur        TEXT NOT NULL,
  amount     REAL NOT NULL CHECK (amount > 0),
  note       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'received',
  created_at TEXT NOT NULL,
  created_by TEXT
);
`,
  },
  {
    n: 24,
    name: 'MAGIS centres: the Accountant may reset passwords (not of those who manage users)',
    sql: `
-- Fouad, 19 October 2026: as in the communities, the Accountant resets a forgotten password;
-- only who manages users (the Superior) resets the password of another who manages users.
-- Only the default Accountant profile of a centre; a hand-made profile is left alone.
UPDATE access_profile SET perms = replace(perms, ']', ',"users.passwords"]')
 WHERE name = 'المحاسب · Accountant' AND perms LIKE '[%"%]' AND perms NOT LIKE '%users.passwords%';
`,
  },
  {
    n: 25,
    name: "MAGIS centres: envelopes — money a book holder hands to a helper",
    sql: `
-- Fouad, 19 October 2026 ("apply the envelope to the book holder"): as the communities'
-- minister does, a holder gives part of his cash to a helper (a facilitator, the cleaner…) in an
-- envelope: a small book of its own, inside his book (parent_id), kept by the same people.
-- Money between the book and its envelopes needs no confirmation; they close their month together.
ALTER TABLE book ADD COLUMN parent_id INTEGER REFERENCES book(id);
`,
  },
  {
    n: 26,
    name: 'MAGIS centres: the note-by-note count is kept with the closing of a book-month',
    sql: `
-- Fouad, 21 October 2026: the cash is counted in the closing window itself, note by note; what was
-- counted (JSON: [{currency, denomination, qty}]) stays with the month it closed.
ALTER TABLE book_month ADD COLUMN count_detail TEXT;
`,
  },
  {
    n: 27,
    name: 'MAGIS centres: the history of the cash counts of each book',
    sql: `
-- Fouad, 21 October 2026: every count that is saved stays in the history of its book, with the
-- date and hour, who counted, the notes, the book at that moment and the difference — useful when
-- there is a mistake. kind: 'count' (saved by hand, after a warning) or 'close' (made at month closing,
-- automatic: it is the reconciliation).
CREATE TABLE cash_count_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     INTEGER NOT NULL REFERENCES book(id),
  at          TEXT NOT NULL,
  who         TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('count','close')),
  ym          TEXT,
  counted_syp REAL NOT NULL DEFAULT 0,
  counted_usd REAL NOT NULL DEFAULT 0,
  book_syp    REAL,
  book_usd    REAL,
  note        TEXT,
  detail      TEXT
);
CREATE INDEX cash_count_log_book ON cash_count_log(book_id, at);
-- the closings already made become the first entries of the history
INSERT INTO cash_count_log (book_id, at, who, kind, ym, counted_syp, counted_usd, book_syp, book_usd, note, detail)
  SELECT book_id, closed_at, closed_by, 'close', ym, counted_syp, counted_usd, book_syp, book_usd, count_note, count_detail
    FROM book_month WHERE counted_syp IS NOT NULL;
`,
  },
  {
    n: 28,
    name: 'communities: the history of the cash counts of each account',
    sql: `
-- Fouad, 21 October 2026 (same as the centres): every count saved stays in the history of the account,
-- with date and hour, who counted, the banknotes, what the book said at that moment and the difference.
-- kind: 'count' (saved by hand, after a warning) or 'close' (made at the closing of a period, automatic).
-- book_id: the main book of the account (pocket, or house); the others of the group are read with it.
CREATE TABLE cty_count_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     INTEGER NOT NULL REFERENCES book(id),
  at          TEXT NOT NULL,
  who         TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('count','close')),
  ym          TEXT,
  held_loc    REAL, held_usd REAL, held_eur REAL,
  counted_loc REAL NOT NULL DEFAULT 0, counted_usd REAL NOT NULL DEFAULT 0, counted_eur REAL NOT NULL DEFAULT 0,
  note        TEXT,
  detail      TEXT
);
CREATE INDEX cty_count_log_book ON cty_count_log(book_id, at);
-- the closings already made become the first entries of the history
INSERT INTO cty_count_log (book_id, at, who, kind, ym, held_loc, held_usd, held_eur, counted_loc, counted_usd, counted_eur, note, detail)
  SELECT book_id, closed_at, closed_by, 'close', ym, book_loc, book_usd, book_eur, COALESCE(counted_loc, 0), COALESCE(counted_usd, 0), COALESCE(counted_eur, 0), count_note, count_detail
    FROM cty_month WHERE counted_loc IS NOT NULL OR counted_usd IS NOT NULL OR counted_eur IS NOT NULL;
`,
  },
  {
    n: 29,
    name: 'HR database: people, volunteer agreements, stipend letters, code of conduct, document vault with its access log',
    sql: `
-- Fouad, 30 October 2026: the HR database (a separate, private database; kind 'hr').
-- A person is a volunteer or a member of the staff. Only the minimum personal data.
CREATE TABLE hr_person (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  father_name TEXT,
  national_id TEXT,
  birth_place TEXT,
  birth_date  TEXT,
  address     TEXT,
  phone       TEXT,
  role        TEXT,
  centre      TEXT,
  started     TEXT,
  ended       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT
);
-- A paper between the centre and a person: a yearly volunteer agreement (kind 'agreement'), or a one-time
-- stipend letter for a named service (kind 'stipend'). The signed scan is attached when it comes back.
CREATE TABLE hr_paper (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES hr_person(id),
  kind        TEXT NOT NULL CHECK (kind IN ('agreement','stipend')),
  start_date  TEXT,
  end_date    TEXT,
  service     TEXT,
  amount      REAL,
  currency    TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','SYP')),
  paid_on     TEXT,
  note        TEXT,
  file        TEXT,
  file_name   TEXT,
  mime        TEXT,
  size        INTEGER,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  deleted_at  TEXT
);
CREATE INDEX hr_paper_person ON hr_paper(person_id, kind);
-- The code of conduct: every version is kept; each person signs a version (with the scan if there is one).
CREATE TABLE hr_conduct (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     TEXT NOT NULL,
  valid_from  TEXT NOT NULL,
  note        TEXT,
  file        TEXT,
  file_name   TEXT,
  mime        TEXT,
  size        INTEGER,
  created_at  TEXT NOT NULL,
  created_by  TEXT
);
CREATE TABLE hr_conduct_sign (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  conduct_id  INTEGER NOT NULL REFERENCES hr_conduct(id),
  person_id   INTEGER NOT NULL REFERENCES hr_person(id),
  signed_on   TEXT NOT NULL,
  file        TEXT,
  file_name   TEXT,
  mime        TEXT,
  size        INTEGER,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  deleted_at  TEXT
);
CREATE INDEX hr_conduct_sign_person ON hr_conduct_sign(person_id, conduct_id);
-- The vault: copies of identity and other documents, with an expiry date if they have one.
CREATE TABLE hr_doc (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES hr_person(id),
  label       TEXT NOT NULL,
  expires_on  TEXT,
  file        TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  deleted_at  TEXT
);
CREATE INDEX hr_doc_person ON hr_doc(person_id);
-- Every time a scan is opened, added or removed, by whom: nothing here is ever changed or deleted.
CREATE TABLE hr_access_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  who         TEXT NOT NULL,
  action      TEXT NOT NULL,
  what        TEXT NOT NULL,
  person_id   INTEGER,
  item_id     INTEGER,
  detail      TEXT
);
`,
  },
  {
    n: 30,
    name: 'HR stage 2: salary scale (grades with an hourly rate per year), pay of each person, hours worked each month',
    sql: `
-- Fouad, 30 October 2026. A grade has a BASE hourly rate (12 months of the year) for each year; the monthly
-- stipend of a person = hourly rate x weekly hours x 52 / 12 (rounded). Weekly hours differ from person to person.
CREATE TABLE hr_grade (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  sort      INTEGER NOT NULL DEFAULT 0,
  note      TEXT,
  active    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE hr_grade_rate (
  grade_id   INTEGER NOT NULL REFERENCES hr_grade(id),
  year       INTEGER NOT NULL,
  hourly_usd REAL NOT NULL,
  PRIMARY KEY (grade_id, year)
);
-- The pay of a person from a date: a grade and weekly hours, or an agreed monthly amount of one's own.
CREATE TABLE hr_pay (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES hr_person(id),
  valid_from  TEXT NOT NULL,
  grade_id    INTEGER REFERENCES hr_grade(id),
  weekly_hours REAL,
  monthly_usd REAL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  deleted_at  TEXT
);
CREATE INDEX hr_pay_person ON hr_pay(person_id, valid_from);
-- The hours really worked in a month (normal hours only).
CREATE TABLE hr_hours (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES hr_person(id),
  ym        TEXT NOT NULL,
  hours     REAL NOT NULL,
  note      TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (person_id, ym)
);
INSERT OR IGNORE INTO setting (key, value) VALUES ('hr_payments_per_year', '13'), ('hr_round_to', '5'), ('hr_max_weekly', '40');
`,
  },
  {
    n: 31,
    name: 'HR stage 3: payroll runs (monthly, and the 13th payment), their lines, the account and budget line of each person',
    sql: `
-- Fouad, 30 October 2026. A run = the stipends of one month (kind 'monthly') or the 13th payment ('thirteenth').
-- Prepared by one person, approved by someone with hr.approve (the Superior), then marked paid.
ALTER TABLE hr_person ADD COLUMN account TEXT;
ALTER TABLE hr_person ADD COLUMN budget_line TEXT;
CREATE TABLE hr_run (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ym          TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('monthly','thirteenth')),
  rate_syp    REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  note        TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  approved_at TEXT,
  approved_by TEXT,
  paid_on     TEXT,
  paid_by     TEXT,
  UNIQUE (ym, kind)
);
CREATE TABLE hr_run_line (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       INTEGER NOT NULL REFERENCES hr_run(id),
  person_id    INTEGER NOT NULL REFERENCES hr_person(id),
  label        TEXT,
  paper_id     INTEGER REFERENCES hr_paper(id),
  weekly_hours REAL,
  hours_worked REAL,
  base_usd     REAL NOT NULL DEFAULT 0,
  bonus_usd    REAL NOT NULL DEFAULT 0,
  deduction_usd REAL NOT NULL DEFAULT 0,
  total_usd    REAL NOT NULL DEFAULT 0,
  paid_in      TEXT NOT NULL DEFAULT 'USD' CHECK (paid_in IN ('USD','SYP')),
  amount_paid  REAL NOT NULL DEFAULT 0,
  account      TEXT,
  budget_line  TEXT,
  note         TEXT
);
CREATE INDEX hr_run_line_run ON hr_run_line(run_id);
`,
  },
  {
    n: 32,
    name: 'HR stage 4: health insurance (the person and the family members, paid yearly), split of a person\'s cost by donor or project',
    sql: `
-- Fouad, 30 October 2026. Insurance is paid yearly: a row per insured person (member_name empty = the staff member
-- himself or herself) with the yearly amount and the end date (a reminder before it).
CREATE TABLE hr_insurance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES hr_person(id),
  member_name TEXT,
  relation    TEXT,
  amount_usd  REAL NOT NULL,
  end_date    TEXT,
  paid_on     TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  deleted_at  TEXT
);
CREATE INDEX hr_insurance_person ON hr_insurance(person_id);
-- The split of a person's cost by donor or project, in percent (it must make 100), from a date.
CREATE TABLE hr_alloc (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES hr_person(id),
  valid_from TEXT NOT NULL,
  target     TEXT NOT NULL,
  pct        REAL NOT NULL CHECK (pct > 0 AND pct <= 100),
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE (person_id, valid_from, target)
);
`,
  },
  {
    n: 33,
    name: 'HR: first and last name, lists taken from the budgets, scale by monthly amount, insurance currency and who pays',
    sql: `
-- Fouad, 30 October 2026 (after the first test).
ALTER TABLE hr_person ADD COLUMN first_name TEXT;
ALTER TABLE hr_person ADD COLUMN last_name TEXT;
UPDATE hr_person SET first_name = name;
-- Centres, accounts and budget lines are chosen from stored lists, filled from the budget of a centre database.
CREATE TABLE hr_list (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  kind    TEXT NOT NULL CHECK (kind IN ('centre','account','line')),
  name    TEXT NOT NULL,
  code    TEXT,
  heading TEXT,
  source  TEXT,
  UNIQUE (kind, name, code)
);
-- The scale is by MONTHLY amount (a position and its amount for each year); the hourly cost is calculated from
-- each person's weekly hours. (The amounts typed before in hourly form are cleared: nothing real was in them.)
ALTER TABLE hr_grade_rate RENAME COLUMN hourly_usd TO monthly_usd;
DELETE FROM hr_grade_rate;
-- Insurance is paid in USD or SYP; the staff member's own is paid by the centre, the family's by the staff member.
ALTER TABLE hr_insurance ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE hr_insurance ADD COLUMN paid_by TEXT NOT NULL DEFAULT 'centre';
UPDATE hr_insurance SET paid_by = 'staff' WHERE member_name IS NOT NULL;
`,
  },
  {
    n: 34,
    name: 'HR review: names and address in Arabic and English, document details per centre, the agreement fixes the stipend, one reference amount per position',
    sql: `
-- Fouad, 30 October 2026 (second test). The agreement is filled in two languages: names and address in Arabic and English.
ALTER TABLE hr_person ADD COLUMN first_name_ar TEXT;
ALTER TABLE hr_person ADD COLUMN last_name_ar TEXT;
ALTER TABLE hr_person ADD COLUMN father_name_ar TEXT;
ALTER TABLE hr_person ADD COLUMN address_ar TEXT;
-- Each centre has its own heading on the documents: its mark (code = jaramana | aleppo | homs | other), the first party
-- and who signs, in both languages.
ALTER TABLE hr_list ADD COLUMN party_ar TEXT;
ALTER TABLE hr_list ADD COLUMN party_en TEXT;
ALTER TABLE hr_list ADD COLUMN rep_ar TEXT;
ALTER TABLE hr_list ADD COLUMN rep_en TEXT;
ALTER TABLE hr_list ADD COLUMN city_ar TEXT;
ALTER TABLE hr_list ADD COLUMN city_en TEXT;
-- The stipend is fixed at the beginning of the agreement (position, monthly amount, weekly hours); it can change from a
-- date in the middle of the year (a pay line of its own). A pay line made by an agreement points to it.
ALTER TABLE hr_paper ADD COLUMN position TEXT;
ALTER TABLE hr_paper ADD COLUMN weekly_hours REAL;
ALTER TABLE hr_pay ADD COLUMN paper_id INTEGER REFERENCES hr_paper(id);
-- A position has ONE reference monthly amount (a suggestion when an agreement is made), not one per year.
ALTER TABLE hr_grade ADD COLUMN monthly_usd REAL;
UPDATE hr_grade SET monthly_usd = (SELECT r.monthly_usd FROM hr_grade_rate r WHERE r.grade_id = hr_grade.id ORDER BY r.year DESC LIMIT 1);
`,
  },
  {
    n: 35,
    name: 'HR: position names in Arabic, each centre\'s salary heading and usual account, payroll sent to the accounts',
    sql: `
-- Fouad, 30 October 2026. A position has a name in Arabic too.
ALTER TABLE hr_grade ADD COLUMN name_ar TEXT;
UPDATE hr_grade SET name_ar = CASE name WHEN 'Centre Director' THEN 'مدير المركز' WHEN 'Workshop Coordinator' THEN 'منسق الورشات' WHEN 'Guard & logistics' THEN 'حارس ولوجستيات'
  WHEN 'Accountant' THEN 'محاسب' WHEN 'Reception' THEN 'استقبال' WHEN 'IT' THEN 'تقنية المعلومات' WHEN 'Cleaner' THEN 'عامل نظافة' WHEN 'Cook' THEN 'طباخ' END WHERE name_ar IS NULL;
-- Each centre: the heading of its budget that holds the stipends, and the account they are paid from (when a person
-- has none of their own). The lines offered for a person are that heading's lines in their centre.
ALTER TABLE hr_list ADD COLUMN salary_heading TEXT;
ALTER TABLE hr_list ADD COLUMN account TEXT;
UPDATE hr_list SET salary_heading = (SELECT l.heading FROM hr_list l WHERE l.kind = 'line' AND l.source = hr_list.source
  AND (lower(l.heading) LIKE '%salar%' OR lower(l.heading) LIKE '%staff%' OR l.heading LIKE '%رات%')
  ORDER BY (lower(l.heading) LIKE '%staff%' AND lower(l.heading) LIKE '%salar%') DESC, lower(l.heading) LIKE '%salar%' DESC LIMIT 1) WHERE kind = 'centre';
-- A payroll run sent to the accounts of a centre: the rows written there (totals only), to take them back if needed.
CREATE TABLE hr_run_sent (
  run_id    INTEGER NOT NULL REFERENCES hr_run(id),
  centre    TEXT NOT NULL,
  sent_at   TEXT NOT NULL,
  sent_by   TEXT,
  trx_ids   TEXT NOT NULL,
  total_usd REAL NOT NULL,
  PRIMARY KEY (run_id, centre)
);
`,
  },
  {
    n: 36,
    name: 'HR: a stipend can be agreed in Syrian pounds (kept as pounds; the dollar equivalent is shown at the dollar rate)',
    sql: `
-- Fouad, 30 October 2026. An agreement in SYP fixes a monthly amount in pounds; payroll pays exactly that, converted at the
-- rate of each run; the card shows its equivalent in dollars at the rate of the settings (or the last run's).
ALTER TABLE hr_pay ADD COLUMN monthly_syp REAL;
`,
  },
  {
    n: 37,
    name: 'HR by centre: each user sees their centres, a scale and a payroll per centre, donors of the accounts, arrival and leaving checklists, leave prepared',
    sql: `
-- Fouad, 31 October 2026. There is an HR keeper for every centre, who sees only that centre; the MAGIS manager sees the
-- three. The centres a user of the HR database sees (a JSON list of centre codes: jaramana, aleppo, homs, other).
-- Empty (NULL) = every centre.
ALTER TABLE profile ADD COLUMN hr_centres TEXT;
-- A position of the scale belongs to a centre (NULL = shared by every centre, as before).
ALTER TABLE hr_grade ADD COLUMN centre TEXT;
-- An account of a centre (a project) and the donors who fund it (from the grants in the accounts), names joined by " | ".
ALTER TABLE hr_list ADD COLUMN donors TEXT;
-- Copying a centre's lists again had added its accounts once more (an account has no code): one of each is kept.
DELETE FROM hr_list WHERE kind = 'account' AND id NOT IN (SELECT MIN(id) FROM hr_list WHERE kind = 'account' GROUP BY name, source);
-- A payroll run belongs to one centre (the run of each centre is prepared and approved on its own). The older runs
-- take the centre of their people when they all have the same one (else NULL: "every centre").
PRAGMA defer_foreign_keys = ON;
CREATE TABLE hr_run_tmp AS SELECT * FROM hr_run;
DROP TABLE hr_run;
CREATE TABLE hr_run (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ym          TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('monthly','thirteenth')),
  centre      TEXT,
  rate_syp    REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  note        TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  approved_at TEXT,
  approved_by TEXT,
  paid_on     TEXT,
  paid_by     TEXT,
  UNIQUE (ym, kind, centre)
);
INSERT INTO hr_run (id, ym, kind, centre, rate_syp, status, note, created_at, created_by, approved_at, approved_by, paid_on, paid_by)
  SELECT t.id, t.ym, t.kind,
    (SELECT CASE WHEN COUNT(DISTINCT c.code) = 1 THEN MAX(c.code) END FROM hr_run_line l JOIN hr_person p ON p.id = l.person_id JOIN hr_list c ON c.kind = 'centre' AND c.name = p.centre WHERE l.run_id = t.id),
    t.rate_syp, t.status, t.note, t.created_at, t.created_by, t.approved_at, t.approved_by, t.paid_on, t.paid_by FROM hr_run_tmp t;
DROP TABLE hr_run_tmp;
-- What is done when someone arrives and when someone leaves: a list kept in the settings, ticked on each person's card.
CREATE TABLE hr_check_item (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kind     TEXT NOT NULL CHECK (kind IN ('arrival','leaving')),
  label_ar TEXT,
  label_en TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0,
  active   INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE hr_check_done (
  person_id  INTEGER NOT NULL REFERENCES hr_person(id),
  item_id    INTEGER NOT NULL REFERENCES hr_check_item(id),
  done_on    TEXT NOT NULL,
  done_by    TEXT,
  note       TEXT,
  PRIMARY KEY (person_id, item_id)
);
INSERT INTO hr_check_item (kind, label_ar, label_en, sort) VALUES
  ('arrival', 'توقيع اتفاقية التطوع', 'Volunteer agreement signed', 1),
  ('arrival', 'توقيع مدونة السلوك', 'Code of conduct signed', 2),
  ('arrival', 'صورة الهوية في خزانة الوثائق', 'Copy of the ID card in the vault', 3),
  ('arrival', 'الهاتف والعنوان مكتوبان', 'Phone and address written', 4),
  ('arrival', 'التأمين الصحي', 'Health insurance', 5),
  ('arrival', 'التعريف بالفريق وبالمركز', 'Introduced to the team and the centre', 6),
  ('arrival', 'المفاتيح والأدوات المسلّمة مكتوبة', 'Keys and equipment handed over are written down', 7),
  ('leaving', 'رسالة إنهاء الاتفاقية موقّعة (براءة ذمة)', 'End-of-agreement letter signed (clearance)', 1),
  ('leaving', 'إعادة المفاتيح والأدوات والبطاقة', 'Keys, equipment and badge returned', 2),
  ('leaving', 'دفع آخر مكافأة والثالثة عشرة بالنسبة', 'Last stipend paid, and the 13th in proportion', 3),
  ('leaving', 'إيقاف التأمين الصحي', 'Health insurance stopped', 4),
  ('leaving', 'إغلاق الحسابات وكلمات السر (الحاسوب، البريد…)', 'Computer, e-mail and other accesses closed', 5),
  ('leaving', 'تسليم العمل الجاري لشخص آخر', 'Ongoing work handed over to someone', 6),
  ('leaving', 'حديث المغادرة', 'Leaving conversation', 7),
  ('leaving', 'شهادة خدمة إن طُلبت', 'Certificate of service, if asked', 8);
-- Leave and holidays: prepared for later (not used yet). The kinds (the agreement gives 10 days of annual leave and
-- 12 days of sick leave) and each leave taken.
CREATE TABLE hr_leave_type (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar       TEXT,
  name_en       TEXT NOT NULL,
  days_per_year REAL,
  paid          INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  sort          INTEGER NOT NULL DEFAULT 0
);
INSERT INTO hr_leave_type (name_ar, name_en, days_per_year, sort) VALUES ('إجازة سنوية', 'Annual leave', 10, 1), ('إجازة مرضية', 'Sick leave', 12, 2);
CREATE TABLE hr_leave (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES hr_person(id),
  type_id    INTEGER NOT NULL REFERENCES hr_leave_type(id),
  from_date  TEXT NOT NULL,
  to_date    TEXT NOT NULL,
  days       REAL NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX hr_leave_person ON hr_leave(person_id);
-- The usual permission profiles of an HR database: the HR keeper of a centre, the Superior, the MAGIS manager.
INSERT OR IGNORE INTO access_profile (name, perms, sort) SELECT 'مسؤول الموارد البشرية في مركز · HR keeper of a centre · Responsable RH d''un centre', '["hr.view","hr.manage","hr.pay","hr.vault"]', 3 WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'kind' AND value = 'hr');
INSERT OR IGNORE INTO access_profile (name, perms, sort) SELECT 'الرئيس · Superior · Supérieur', '["hr.view","hr.manage","hr.pay","hr.approve","hr.vault","audit.view"]', 4 WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'kind' AND value = 'hr');
INSERT OR IGNORE INTO access_profile (name, perms, sort) SELECT 'مدير ماجيس · MAGIS manager · Directeur MAGIS', '["hr.view","hr.manage","hr.pay","hr.approve","hr.vault","users.manage","data.backup","data.restore","data.export","audit.view"]', 5 WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'kind' AND value = 'hr');
`,
  },
  {
    n: 38,
    name: 'HR tutors paid by session: a category for each person, the price of a session in the settings, the sessions by date',
    sql: `
-- Fouad, 31 October 2026. Besides the staff with an agreement, the centres pay tutors (workshop animators, tutors) by
-- session: no agreement, one price per session (set in the settings), the sessions recorded by date with their activity;
-- at the end of the month they go into the centre's payroll run.
ALTER TABLE hr_person ADD COLUMN category TEXT NOT NULL DEFAULT 'staff';
-- a tutor's usual activity (offered when a session is recorded)
ALTER TABLE hr_person ADD COLUMN activity TEXT;
-- the price of one session, from a date (a new price does not change the months before it)
CREATE TABLE hr_session_price (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  valid_from TEXT NOT NULL,
  amount     REAL NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','SYP')),
  created_at TEXT NOT NULL,
  created_by TEXT
);
-- one session led by a tutor. run_line_id: the payroll line that pays it (then it can no longer change).
-- source/ext_id: where it came from ('hand', or 'calendar' with the calendar's session number, imported later).
CREATE TABLE hr_session (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES hr_person(id),
  on_date     TEXT NOT NULL,
  activity    TEXT,
  note        TEXT,
  source      TEXT NOT NULL DEFAULT 'hand',
  ext_id      TEXT,
  run_line_id INTEGER REFERENCES hr_run_line(id),
  created_at  TEXT NOT NULL,
  created_by  TEXT
);
CREATE INDEX hr_session_person ON hr_session(person_id, on_date);
CREATE UNIQUE INDEX hr_session_ext ON hr_session(source, ext_id) WHERE ext_id IS NOT NULL;
-- a payroll line for sessions: how many (its pounds are exact, like a stipend letter's)
ALTER TABLE hr_run_line ADD COLUMN sessions INTEGER;
`,
  },
  {
    n: 39,
    name: 'HR rights in detail: personal details, amounts, agreements, scale, sessions, paid',
    sql: `
-- Fouad, 1 November 2026: the HR rights are split so a role can be made for each job (a workshop coordinator who only
-- records the sessions and does not see the salaries; an HR keeper who does not see the personal details...). Each role
-- keeps what it could do before: the old tick brings the new ticks it contained. (Only the amounts of the agreements,
-- once shown to every reader, now need "sees the amounts".)
UPDATE access_profile SET perms = replace(perms, '"hr.view"', '"hr.view","hr.details"') WHERE perms LIKE '%"hr.view"%' AND perms NOT LIKE '%"hr.details"%';
UPDATE access_profile SET perms = replace(perms, '"hr.manage"', '"hr.manage","hr.agreements"') WHERE perms LIKE '%"hr.manage"%' AND perms NOT LIKE '%"hr.agreements"%';
UPDATE access_profile SET perms = replace(perms, '"hr.pay"', '"hr.pay","hr.salary","hr.scale","hr.sessions"') WHERE perms LIKE '%"hr.pay"%' AND perms NOT LIKE '%"hr.salary"%';
UPDATE access_profile SET perms = replace(perms, '"hr.approve"', '"hr.approve","hr.paid"') WHERE perms LIKE '%"hr.approve"%' AND perms NOT LIKE '%"hr.paid"%';
-- writing agreements shows their amounts
UPDATE access_profile SET perms = replace(perms, '"hr.agreements"', '"hr.agreements","hr.salary"') WHERE perms LIKE '%"hr.agreements"%' AND perms NOT LIKE '%"hr.salary"%';
`,
  },  {
    n: 40,
    name: 'grants divided by centre: the share of each centre; here the share goes to one fund',
    sql: `
-- A grant may cover several centres (Fouad, 2026-11-01): the amount of each.
-- Here, this centre's share goes to one fund (grant_part). A grant without shares is all for here.
CREATE TABLE grant_share (
  grant_id TEXT NOT NULL REFERENCES grant_card(id),
  centre   TEXT NOT NULL,
  amount   REAL NOT NULL CHECK (amount > 0),
  PRIMARY KEY (grant_id, centre)
);
`,
  },
  {
    n: 41,
    name: 'one budget for the centre: each line has one amount and at most one fund (or "not funded"); one contingency per budget',
    sql: `
-- The reserve is the budget's, not an account's (it was set only on Center: the largest is kept).
ALTER TABLE budget_version ADD COLUMN contingency_pct REAL NOT NULL DEFAULT 0;
UPDATE budget_version SET contingency_pct = COALESCE((SELECT MAX(contingency_pct) FROM budget_account a WHERE a.version_id = budget_version.id), 0);
-- A line once under several accounts becomes one line (Fouad, 2026-11-01): its amounts added together,
-- its fund the account that had the largest amount. Funds outside the budget (Deir) are not the centre's
-- budget: their amounts leave it, as the follow-up already left them out.
CREATE TABLE budget_amount_new (
  version_id INTEGER NOT NULL REFERENCES budget_version(id),
  line_id    INTEGER NOT NULL REFERENCES budget_line(id),
  account_id INTEGER REFERENCES account(id),
  amount_usd REAL NOT NULL,
  PRIMARY KEY (version_id, line_id)
);
INSERT INTO budget_amount_new (version_id, line_id, account_id, amount_usd)
  SELECT x.version_id, x.line_id,
         (SELECT y.account_id FROM budget_amount y JOIN account a ON a.id = y.account_id
           WHERE y.version_id = x.version_id AND y.line_id = x.line_id AND a.outside_budget = 0
           ORDER BY y.amount_usd DESC, y.account_id LIMIT 1),
         SUM(x.amount_usd)
    FROM budget_amount x JOIN account a ON a.id = x.account_id
   WHERE a.outside_budget = 0
   GROUP BY x.version_id, x.line_id;
CREATE TABLE budget_item_new (
  id         INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES budget_version(id),
  line_id    INTEGER NOT NULL REFERENCES budget_line(id),
  name       TEXT NOT NULL,
  unit       TEXT,
  qty        REAL NOT NULL,
  times      REAL NOT NULL,
  unit_cost  REAL NOT NULL,
  note       TEXT,
  sort       INTEGER NOT NULL DEFAULT 0
);
INSERT INTO budget_item_new (id, version_id, line_id, name, unit, qty, times, unit_cost, note, sort)
  SELECT i.id, i.version_id, i.line_id, i.name, i.unit, i.qty, i.times, i.unit_cost, i.note, i.sort
    FROM budget_item i JOIN account a ON a.id = i.account_id WHERE a.outside_budget = 0;
DROP TABLE budget_amount;
ALTER TABLE budget_amount_new RENAME TO budget_amount;
DROP TABLE budget_item;
ALTER TABLE budget_item_new RENAME TO budget_item;
CREATE INDEX budget_item_line ON budget_item(version_id, line_id);
`,
  },
  {
    n: 42,
    name: 'one list for every centre: each heading and line has an identity that is the same in every database',
    sql: `
-- (Fouad, 2026-11-01: one common list of headings and lines for all the centres.) The id of a heading or a line is
-- this database's own; uid is the same in every database that has it, so the centres' reports go together. Given
-- by the program to every new heading or line; the common list (taken from Homs) and the matching come next (the
-- Income, Transfer and Exchange headings are then recognised by their type).
ALTER TABLE heading ADD COLUMN uid TEXT;
ALTER TABLE budget_line ADD COLUMN uid TEXT;
UPDATE heading SET uid = lower(hex(randomblob(8))) WHERE uid IS NULL;
UPDATE budget_line SET uid = lower(hex(randomblob(8))) WHERE uid IS NULL;
CREATE UNIQUE INDEX heading_uid ON heading(uid);
CREATE UNIQUE INDEX budget_line_uid ON budget_line(uid);
-- a new heading or line gets its identity by itself (a copy of the common list brings its own)
CREATE TRIGGER heading_uid_new AFTER INSERT ON heading WHEN NEW.uid IS NULL
BEGIN UPDATE heading SET uid = lower(hex(randomblob(8))) WHERE id = NEW.id; END;
CREATE TRIGGER budget_line_uid_new AFTER INSERT ON budget_line WHEN NEW.uid IS NULL
BEGIN UPDATE budget_line SET uid = lower(hex(randomblob(8))) WHERE id = NEW.id; END;
`,
  },
  {
    n: 43,
    name: 'bill codes kept when line codes change; merged lines kept (switched off, pointing to their line); project dates; HR lines by identity',
    sql: `
-- (bill_code: not used; the bill code no longer depends on the line, Fouad 2026-11-02 — centre-N-receipt-DDMM)
ALTER TABLE trx ADD COLUMN bill_code TEXT;
-- A line merged into another when joining the common list stays, switched off, pointing to it: a keeper's file
-- written on it still comes in (on that line).
ALTER TABLE budget_line ADD COLUMN merged_into INTEGER REFERENCES budget_line(id);
-- A project's dates (a grant's period): outside them, its lines' expenses are not funded.
ALTER TABLE account ADD COLUMN start_date TEXT;
ALTER TABLE account ADD COLUMN end_date TEXT;
-- HR: a line copied from a centre is known by its identity there; and what was copied, to copy again by itself.
ALTER TABLE hr_list ADD COLUMN uid TEXT;
ALTER TABLE hr_list ADD COLUMN copied_hash TEXT;
`,
  },
  {
    n: 44,
    name: 'HR: the lines a centre pays its tutors on (tutor lines), chosen once per centre',
    sql: `
-- A tutor's card offers only the tutor lines of their centre (Fouad, 2026-11-02), as the staff's are the salary lines.
ALTER TABLE hr_list ADD COLUMN tutor INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    n: 45,
    name: 'HR: the tutor lines suggested on the copies already made (as at a new copy)',
    sql: `
-- A centre with no tutor line ticked yet gets the usual suggestion (Formation lines, facilitators, teachers); its own
-- choice, once made in the Settings, is never touched.
UPDATE hr_list SET tutor = 1
 WHERE kind = 'line' AND source IN (SELECT source FROM hr_list WHERE kind = 'line' AND source IS NOT NULL GROUP BY source HAVING SUM(tutor) = 0)
   AND (heading LIKE '%formation%' OR heading LIKE '%teacher%' OR name LIKE '%facilitator%' OR name LIKE '%teacher%');
`,
  },
  {
    n: 46,
    name: 'the main list: which headings and lines of this database come from it',
    sql: `
-- (Fouad, 2026-11-03) One main list of headings and lines on the server, kept by the administrator; each centre takes
-- what it needs from it. A heading or line taken from it keeps its name and code (the centre only switches it off).
ALTER TABLE heading ADD COLUMN in_main INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budget_line ADD COLUMN in_main INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    n: 47,
    name: "the Coordinator's grants on the Province account, and their split between the centres' projects",
    sql: `
-- (Fouad, 2026-11-07) Used only by the Province account: the Coordinator manages the grants entirely. The money of a
-- grant arrives on the Province's account (its income rows carry grant_id), then is sent to the centres. Each part
-- names a project in a centre's database (by its slug and the project's id there), with a sum or a percentage.
CREATE TABLE net_grant (
  id          TEXT PRIMARY KEY,
  donor       TEXT NOT NULL,
  reference   TEXT,
  amount      REAL NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL CHECK (currency IN ('USD','EUR')),
  start_date  TEXT,
  end_date    TEXT,
  closed      INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT
);
CREATE TABLE net_grant_part (
  id           INTEGER PRIMARY KEY,
  grant_id     TEXT NOT NULL REFERENCES net_grant(id),
  centre       TEXT NOT NULL,
  centre_name  TEXT,
  project_id   INTEGER,
  project_name TEXT,
  amount       REAL CHECK (amount IS NULL OR amount >= 0),
  pct          REAL CHECK (pct IS NULL OR (pct >= 0 AND pct <= 100)),
  sort         INTEGER NOT NULL DEFAULT 0
);
`,
  },
  {
    n: 48,
    name: 'money sent by the Province to the centres: the send on the Province account, and what the centre sees and answers',
    sql: `
-- (Fouad, 2026-11-07) The Province account: each send is a transfer row (Province account -> "Sent to the centres"),
-- with the centre and the project it goes to. The centre: the same send, waiting for its answer (accepted: an income
-- in its grants book, for that project; or "not received", with a word). The same rules as a transfer between books.
CREATE TABLE net_send (
  trx_id       TEXT PRIMARY KEY,
  centre       TEXT NOT NULL,
  centre_name  TEXT,
  project_id   INTEGER,
  project_name TEXT
);
CREATE TABLE province_send (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  usd          REAL NOT NULL DEFAULT 0,
  syp          REAL NOT NULL DEFAULT 0,
  project_id   INTEGER REFERENCES account(id),
  donor        TEXT,
  reference    TEXT,
  explanation  TEXT,
  sent_by      TEXT,
  status       TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','accepted','disputed')),
  note         TEXT,
  answered_at  TEXT,
  answered_by  TEXT,
  income_id    TEXT
);
`,
  },
  {
    n: 49,
    name: 'the Province account: euros received, changed into dollars (the euros kept with the dollar row)',
    sql: `
-- (Fouad, 2026-11-11) A grant in euros: its money arrives in euros and is changed into dollars. The dollar row is the
-- Province's income; the euros it came from are kept here, so the grant's "received" is known in its own currency.
CREATE TABLE net_eur_in (
  trx_id TEXT PRIMARY KEY,
  eur    REAL NOT NULL CHECK (eur > 0)
);
`,
  },
  {
    n: 50,
    name: 'HR: the cost of an hour, Donors & funding and Reports each have their own tick; Excel needs "Exports"',
    sql: `
-- (Fouad, 2026-11-12) The cost of an hour came with "approves a run": the roles that approve keep it.
UPDATE access_profile SET perms = replace(perms, ']', ',"hr.hourly"]')
 WHERE perms LIKE '%"hr.approve"%' AND perms NOT LIKE '%"hr.hourly"%';
-- Donors & funding and Reports came with "Sees the amounts": they stay with the roles that approve or manage the users
-- (the Superior, the HR keeper, the MAGIS manager), not with an HR keeper of a centre.
UPDATE access_profile SET perms = replace(perms, ']', ',"hr.donors","hr.reports"]')
 WHERE perms LIKE '%"hr.salary"%' AND (perms LIKE '%"hr.approve"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"hr.donors"%';
-- the Excel files of HR now need "Exports": every role that sees the amounts keeps them
UPDATE access_profile SET perms = replace(perms, ']', ',"data.export"]')
 WHERE perms LIKE '%"hr.salary"%' AND perms NOT LIKE '%"data.export"%';
`,
  },
  {
    n: 51,
    name: 'the phones: a person records expenses and income away from the centre, the phone sends them later',
    sql: `
-- (Fouad, 2026-11-13) A phone is paired once by its owner; it holds a long key, the server only the key's hash.
-- It must come back within 30 days of its last sync; whoever manages the users can cut it off (revoked_at).
CREATE TABLE phone (
  id         TEXT PRIMARY KEY,
  profile_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  key_hash   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_sync  TEXT,
  revoked_at TEXT,
  revoked_by TEXT
);
-- the photos a phone already sent (its own number for each), so that none comes twice
CREATE TABLE phone_photo (
  key           TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL,
  at            TEXT NOT NULL
);
`,
  },
  {
    n: 52,
    name: 'communities: a Jesuit may spend for the house from his own pocket ("For the house")',
    sql: `
-- (Fouad, 2026-11-15) A Jesuit often pays something for the community (food, fuel...). The money leaves his pocket,
-- but the expense counts with the house, not as his personal expense. 1 = for the house.
ALTER TABLE cty_entry ADD COLUMN for_house INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    n: 53,
    name: 'the Superior sees the private books: a new tick "Sees the private books" (status and records)',
    sql: `
-- (Fouad, 2026-11-21) A private book is hidden from the Accountant and the others, not from the Superior.
-- The roles that manage the users AND see every book (the Superior's) get the tick; the Accountant's does not.
UPDATE access_profile SET perms = replace(perms, ']', ',"register.private"]')
 WHERE perms LIKE '%"users.manage"%' AND perms LIKE '%"register.view"%' AND perms NOT LIKE '%"register.private"%';
`,
  },
  {
    n: 54,
    name: 'a tick for downloading a copy of the database ("Downloads a copy"), given to the roles that back up or restore',
    sql: `
-- (Fouad, 2026-11-21) The copy that leaves the server is protected by a password, and only those who need it download it.
-- The roles that had Backups or Restore keep the download; Export to Excel no longer carries it.
UPDATE access_profile SET perms = replace(perms, ']', ',"data.download"]')
 WHERE (perms LIKE '%"data.backup"%' OR perms LIKE '%"data.restore"%') AND perms NOT LIKE '%"data.download"%';
`,
  },
  {
    n: 55,
    name: 'the inventory: what the centre owns (items, places, categories, history), linked to the purchases in the register',
    sql: `
-- (Fouad, 2026-11-21) The finance follows the assets: every purchase on a furniture/equipment line must be listed here.
-- Value: the purchase entry's USD value when bought; an estimated value for a gift or something old. No depreciation.
CREATE TABLE inv_category (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  serial INTEGER NOT NULL DEFAULT 0,      -- 1: a serial number is expected (IT equipment)
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO inv_category (name, serial, sort) VALUES
  ('IT equipment · معدات معلوماتية', 1, 1),
  ('Audio-visual · صوت وصورة', 1, 2),
  ('Furniture · أثاث', 0, 3),
  ('Appliances · أجهزة كهربائية', 0, 4),
  ('Kitchen · مطبخ', 0, 5),
  ('Books and games · كتب وألعاب', 0, 6),
  ('Tools and maintenance · أدوات وصيانة', 0, 7),
  ('Other · أخرى', 0, 8);
CREATE TABLE inv_place (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);
-- which headings (or single lines) of the budget are inventory purchases: an expense on them must be listed
CREATE TABLE inv_source (
  kind TEXT NOT NULL CHECK (kind IN ('heading','line')),
  ref  INTEGER NOT NULL,
  PRIMARY KEY (kind, ref)
);
INSERT INTO inv_source (kind, ref) SELECT 'heading', id FROM heading
 WHERE lower(name) LIKE '%furniture%' OR lower(name) LIKE '%equipment%' OR name LIKE '%أثاث%' OR name LIKE '%معدات%' OR name LIKE '%تجهيزات%';
CREATE TABLE inv_item (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,          -- the label on the object (JAR-0001)
  name        TEXT NOT NULL,
  category_id INTEGER REFERENCES inv_category(id),
  place_id    INTEGER REFERENCES inv_place(id),
  qty         INTEGER NOT NULL DEFAULT 1,
  brand       TEXT,
  model       TEXT,
  serial      TEXT,
  condition   TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('good','repair','broken')),
  status      TEXT NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_use','disposed','lost')),
  holder      TEXT,                          -- the person who has it (free text), if one does
  origin      TEXT NOT NULL DEFAULT 'bought' CHECK (origin IN ('bought','gift','old')),
  acquired_on TEXT,
  trx_id      TEXT,                          -- the purchase entry in the register (bought)
  party_id    INTEGER REFERENCES party(id),  -- the supplier
  value_usd   REAL,                          -- one unit: from the entry when bought, estimated otherwise
  value_note  TEXT,                          -- how the value was estimated
  counted_on  TEXT,                          -- the last count
  note        TEXT,
  disposed_on TEXT,
  disposed_why TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT
);
CREATE INDEX inv_item_trx ON inv_item(trx_id);
CREATE TABLE inv_move (
  id       INTEGER PRIMARY KEY,
  item_id  INTEGER NOT NULL REFERENCES inv_item(id),
  on_date  TEXT NOT NULL,
  kind     TEXT NOT NULL,                    -- added | moved | given | returned | repaired | broken | counted | disposed | lost | edited
  place_id INTEGER REFERENCES inv_place(id),
  holder   TEXT,
  note     TEXT,
  who      TEXT,
  at       TEXT NOT NULL
);
CREATE INDEX inv_move_item ON inv_move(item_id);
-- a purchase on an inventory line that is not an item (a repair, a delivery fee...)
CREATE TABLE inv_skip (
  trx_id TEXT PRIMARY KEY,
  reason TEXT,
  who    TEXT,
  at     TEXT NOT NULL
);
-- the Accountant keeps it (who sees every book and manages the lists, like the Superior); anyone else who sees every
-- book may look; the others are given the ticks by the Superior
UPDATE access_profile SET perms = replace(perms, ']', ',"inventory.view","inventory.manage"]')
 WHERE perms LIKE '%"register.view"%' AND perms LIKE '%"lists.manage"%' AND perms NOT LIKE '%"inventory.view"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"inventory.view"]')
 WHERE perms LIKE '%"register.view"%' AND perms NOT LIKE '%"inventory.view"%';
`,
  },
  {
    n: 56,
    name: 'inventory: photos of the items',
    sql: `
-- (Fouad, 2026-11-21) A photo of an item, kept as a file in the database's attachments folder (inventory/<label>-N.jpg),
-- like the scans of the bills: it is not in the copies of the database. Removed = marked, the file stays.
CREATE TABLE inv_photo (
  id         TEXT PRIMARY KEY,
  item_id    INTEGER NOT NULL REFERENCES inv_item(id),
  file       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX inv_photo_item ON inv_photo(item_id);
`,
  },
  {
    n: 57,
    name: 'inventory: the origins of an item are a list the keeper edits (bought, gift, old…)',
    sql: `
-- (Fouad, 2026-11-21) Where an item comes from is a list of the centre: "Bought" is the one made by a purchase entry
-- (it cannot be switched off); the others are free (gift, old, given by a donor, made by the youth…).
CREATE TABLE inv_origin (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  bought INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO inv_origin (id, name, bought, sort) VALUES (1, 'Bought · مشترى', 1, 1), (2, 'Gift · هدية', 0, 2), (3, 'Old · قديم', 0, 3);
ALTER TABLE inv_item ADD COLUMN origin_id INTEGER REFERENCES inv_origin(id);
UPDATE inv_item SET origin_id = CASE origin WHEN 'bought' THEN 1 WHEN 'gift' THEN 2 ELSE 3 END;
`,
  },
  {
    n: 58,
    name: 'accommodation and events: buildings, rooms, bookings, services, payments to suggest',
    sql: `
-- (Fouad, 2026-11-22) A centre may host groups (Al-Ard is a farm with guest houses): buildings with rooms, a booking per
-- group (a stay, or an event in a hall), the services sold with it, and payments that the accountant turns into entries.
-- The section is switched on per centre (meta sec_hosting). The amounts are seen only by those who keep the calendar.
CREATE TABLE host_building (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE host_room (
  id          INTEGER PRIMARY KEY,
  building_id INTEGER NOT NULL REFERENCES host_building(id),
  name        TEXT NOT NULL,
  beds        INTEGER NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL DEFAULT 'bedroom' CHECK (kind IN ('bedroom','hall','other')),
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  place_id    INTEGER REFERENCES inv_place(id),   -- the same room as a place of the inventory
  UNIQUE (building_id, name)
);
CREATE TABLE host_service (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO host_service (name, sort) VALUES
  ('Breakfast · فطور', 1), ('Lunch · غداء', 2), ('Dinner · عشاء', 3), ('Break · استراحة', 4),
  ('Logistics · تجهيزات', 5), ('Heating · تدفئة', 6), ('Other · أخرى', 7);
CREATE TABLE host_booking (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL DEFAULT 'stay' CHECK (kind IN ('stay','event')),
  status       TEXT NOT NULL DEFAULT 'option' CHECK (status IN ('option','confirmed','arrived','left','cancelled')),
  group_name   TEXT NOT NULL,
  contact      TEXT,
  phone        TEXT,
  people       INTEGER NOT NULL DEFAULT 0,
  from_day     TEXT NOT NULL,
  to_day       TEXT NOT NULL,
  price_mode   TEXT CHECK (price_mode IN ('person','group')),
  rate         REAL,
  currency     TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','SYP')),
  note         TEXT,
  cancel_reason TEXT,
  source       TEXT NOT NULL DEFAULT 'desk',
  review       INTEGER NOT NULL DEFAULT 0,
  client_ref   TEXT UNIQUE,                  -- the phone's own number for a booking, so it is never made twice
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT
);
CREATE INDEX host_booking_days ON host_booking(from_day, to_day);
CREATE TABLE host_alloc (
  booking_id INTEGER NOT NULL REFERENCES host_booking(id) ON DELETE CASCADE,
  room_id    INTEGER NOT NULL REFERENCES host_room(id),
  beds       INTEGER,                         -- the beds used; NULL: the whole room
  PRIMARY KEY (booking_id, room_id)
);
CREATE TABLE host_line (
  id         INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES host_booking(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES host_service(id),
  label      TEXT NOT NULL,
  qty        REAL NOT NULL DEFAULT 1,
  amount     REAL NOT NULL DEFAULT 0          -- the agreed amount for the whole line, in the booking's currency
);
CREATE TABLE host_pay (
  id         INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES host_booking(id),
  amount     REAL NOT NULL,
  currency   TEXT NOT NULL CHECK (currency IN ('USD','SYP')),
  paid_on    TEXT NOT NULL,
  method     TEXT NOT NULL DEFAULT 'cash',
  receipt_no TEXT NOT NULL UNIQUE,            -- also written on the entry of the register: that is how the two are linked
  status     TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','refused')),
  note       TEXT,
  who        TEXT,
  at         TEXT NOT NULL
);
-- the Accountant and the Superior keep the calendar; whoever sees every book may look
UPDATE access_profile SET perms = replace(perms, ']', ',"hosting.view","hosting.book","hosting.keep"]')
 WHERE perms LIKE '%"register.view"%' AND perms LIKE '%"lists.manage"%' AND perms NOT LIKE '%"hosting.view"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"hosting.view"]')
 WHERE perms LIKE '%"register.view"%' AND perms NOT LIKE '%"hosting.view"%';
`,
  },
  {
    n: 59,
    name: 'hosting: a colour per building, events that repeat every week with their hours, a currency per service line',
    sql: `
-- (Fouad, 2026-11-22) Like the website's calendar: a colour per building/area; an event may repeat every week on chosen
-- weekdays between two dates (events only, never a stay) and has hours; each service line has its own currency.
ALTER TABLE host_building ADD COLUMN color TEXT;
ALTER TABLE host_booking ADD COLUMN repeat_days TEXT;
ALTER TABLE host_booking ADD COLUMN time_from TEXT;
ALTER TABLE host_booking ADD COLUMN time_to TEXT;
ALTER TABLE host_line ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
UPDATE host_line SET currency = COALESCE((SELECT b.currency FROM host_booking b WHERE b.id = host_line.booking_id), 'USD');
`,
  },
  {
    n: 60,
    name: 'hosting: seeing the prices is its own tick (those who keep the calendar keep it)',
    sql: `
-- (Fouad, 2026-11-22) The Superior decides, role by role, who sees the prices: reception may book without them.
UPDATE access_profile SET perms = replace(perms, ']', ',"hosting.prices"]')
 WHERE perms LIKE '%"hosting.keep"%' AND perms NOT LIKE '%"hosting.prices"%';
`,
  },
  {
    n: 61,
    name: 'hosting: a list of kinds of room (a hall has a capacity, a bedroom has beds)',
    sql: `
-- (Fouad, 2026-11-22) The kinds of room are a list the keeper edits (bedroom, hall, classroom, meeting room…). A kind either
-- has beds (people sleep there) or is a meeting space with a maximum number of people. What a hall holds (projector, sound,
-- chairs…) is read from the inventory: the room is already a place of the inventory.
CREATE TABLE host_kind (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sleeps INTEGER NOT NULL DEFAULT 0,          -- 1: has beds
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO host_kind (id, name, sleeps, sort) VALUES
  (1, 'Bedroom · غرفة نوم', 1, 1), (2, 'Hall · قاعة', 0, 2), (3, 'Classroom · صف', 0, 3),
  (4, 'Meeting room · قاعة اجتماعات', 0, 4), (5, 'Dining room · قاعة طعام', 0, 5), (6, 'Other · أخرى', 0, 6);
ALTER TABLE host_room ADD COLUMN kind_id INTEGER REFERENCES host_kind(id);
ALTER TABLE host_room ADD COLUMN capacity INTEGER NOT NULL DEFAULT 0;   -- the most people a meeting space holds
UPDATE host_room SET kind_id = CASE kind WHEN 'bedroom' THEN 1 WHEN 'hall' THEN 2 ELSE 6 END;
`,
  },
  {
    n: 62,
    name: 'hosting: equipment a booking asks for (a list taken from the inventory), checked against what the inventory holds',
    sql: `
-- (Fouad, 2026-11-22) A group may need a whiteboard, a video projector, speakers… The list of what can be asked for is chosen
-- from the inventory's own item names; how many exist is counted live from the inventory (items in use and in good condition).
-- If the bookings that overlap ask for more than exists, the program says so before it happens.
CREATE TABLE host_equip (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- an item name of the inventory
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE host_need (
  booking_id INTEGER NOT NULL REFERENCES host_booking(id) ON DELETE CASCADE,
  equip_id   INTEGER NOT NULL REFERENCES host_equip(id),
  qty        INTEGER NOT NULL CHECK (qty >= 1),
  PRIMARY KEY (booking_id, equip_id)
);
`,
  },
  {
    n: 63,
    name: 'a personal colour and page background for each person (comfort of the pages)',
    sql: `
-- (Fouad, 2026-11-22) Each person may choose the colour of the menu and the buttons, and a softer page background. NULL = the
-- house's own look (set by the Superior in Admin → Appearance). It follows the person on every computer.
ALTER TABLE profile ADD COLUMN ui_color TEXT;   -- #rrggbb or NULL
ALTER TABLE profile ADD COLUMN ui_bg    TEXT;   -- the name of a ready background (brand.ts) or NULL
`,
  },
  {
    n: 64,
    name: 'calendar: areas and spaces with categories (Halls, Rooms), kinds of space, spaces closed for repairs, closed periods',
    sql: `
-- (Fouad, 22-24 November 2026, calendar baseline 2.1, step 1) The calendar of each centre starts from the 0.12 hosting
-- tables: a building is now an AREA (it keeps its colour), a room is a SPACE. Nothing of 0.12 is removed.
-- Categories are the quick views of the calendar: Halls and Rooms (bedrooms), more may be added (Playground...).
CREATE TABLE cal_category (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO cal_category (id, name, sort) VALUES (1, 'Halls · القاعات', 1), (2, 'Rooms · الغرف', 2);
-- each kind of space belongs to a category (a kind with beds: Rooms, any other: Halls)
ALTER TABLE host_kind ADD COLUMN category_id INTEGER REFERENCES cal_category(id);
UPDATE host_kind SET category_id = CASE WHEN sleeps = 1 THEN 2 ELSE 1 END;
UPDATE host_kind SET sort = 99 WHERE id = 6 AND name = 'Other · أخرى';
INSERT INTO host_kind (name, sleeps, sort, category_id) SELECT 'Kitchen · مطبخ', 0, 7, 1 WHERE NOT EXISTS (SELECT 1 FROM host_kind WHERE name = 'Kitchen · مطبخ');
INSERT INTO host_kind (name, sleeps, sort, category_id) SELECT 'Library · مكتبة', 0, 8, 1 WHERE NOT EXISTS (SELECT 1 FROM host_kind WHERE name = 'Library · مكتبة');
INSERT INTO host_kind (name, sleeps, sort, category_id) SELECT 'Chapel · كنيسة', 0, 9, 1 WHERE NOT EXISTS (SELECT 1 FROM host_kind WHERE name = 'Chapel · كنيسة');
INSERT INTO host_kind (name, sleeps, sort, category_id) SELECT 'Outdoor · ساحة خارجية', 0, 10, 1 WHERE NOT EXISTS (SELECT 1 FROM host_kind WHERE name = 'Outdoor · ساحة خارجية');
INSERT INTO host_kind (name, sleeps, sort, category_id) SELECT 'Office · مكتب', 0, 11, 1 WHERE NOT EXISTS (SELECT 1 FROM host_kind WHERE name = 'Office · مكتب');
-- a space: its floor, rentable (an outside group may book it) or ours only, what is always in it, a note, and a
-- category of its own when it is not the one of its kind (NULL: the kind's)
ALTER TABLE host_room ADD COLUMN floor TEXT;
ALTER TABLE host_room ADD COLUMN rentable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE host_room ADD COLUMN fixed TEXT;
ALTER TABLE host_room ADD COLUMN note TEXT;
ALTER TABLE host_room ADD COLUMN category_id INTEGER REFERENCES cal_category(id);
-- a space closed for a while (repairs, painting): nothing can be booked there. Never deleted: cancelled with a reason.
CREATE TABLE cal_space_closed (
  id            INTEGER PRIMARY KEY,
  room_id       INTEGER NOT NULL REFERENCES host_room(id),
  from_day      TEXT NOT NULL,
  to_day        TEXT NOT NULL,
  reason        TEXT NOT NULL,
  cancelled     INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  who           TEXT,
  at            TEXT NOT NULL
);
-- the centre closed (holidays, usually August): a band and a warning, booking stays possible
CREATE TABLE cal_closed_period (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  from_day      TEXT NOT NULL,
  to_day        TEXT NOT NULL,
  cancelled     INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  who           TEXT,
  at            TEXT NOT NULL
);
`,
  },
  {
    n: 65,
    name: 'calendar: our programme and outside bookings, organisations with their persons, private, whole centre, holds, free tick, dates moved or cancelled, price history',
    sql: `
-- (Fouad, calendar baseline 2.1, step 1) One calendar for our own activities and for the bookings of others.
-- The kinds of our activities, each with a colour (an editable list)
CREATE TABLE cal_activity_kind (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color  TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO cal_activity_kind (id, name, color, sort) VALUES
  (1, 'Workshop · ورشة', '#B5D4F4', 1), (2, 'Course · دورة', '#9FE1CB', 2), (3, 'Club · نادي', '#CECBF6', 3),
  (4, 'Training · تدريب', '#C0DD97', 4), (5, 'Event · نشاط', '#FAC775', 5), (6, 'Christian education · تعليم مسيحي', '#F4C0D1', 6),
  (7, 'Prayer groups · فرق صلاة', '#F5C4B3', 7);
-- organisations, registered once, with one or several persons in charge (the person is chosen for each booking)
CREATE TABLE cal_org_kind (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO cal_org_kind (id, name, sort) VALUES
  (1, 'Church · كنيسة', 1), (2, 'Parish group · مجموعة رعوية', 2), (3, 'Association · جمعية', 3), (4, 'School · مدرسة', 4),
  (5, 'University · جامعة', 5), (6, 'Company · شركة', 6), (7, 'Person · شخص', 7), (8, 'Other · أخرى', 8);
CREATE TABLE cal_org (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind_id    INTEGER REFERENCES cal_org_kind(id),
  note       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE cal_org_person (
  id     INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES cal_org(id),
  name   TEXT NOT NULL,
  phone  TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort   INTEGER NOT NULL DEFAULT 0
);
-- a booking is OURS (our programme) or OUTSIDE (a hall booking or a guest stay). The 0.12 bookings were all for groups
-- from outside. group_name stays the name shown: the title of our activity, or the organisation or person.
ALTER TABLE host_booking ADD COLUMN origin TEXT NOT NULL DEFAULT 'outside' CHECK (origin IN ('ours','outside'));
ALTER TABLE host_booking ADD COLUMN activity_kind_id INTEGER REFERENCES cal_activity_kind(id);
ALTER TABLE host_booking ADD COLUMN leader TEXT;
ALTER TABLE host_booking ADD COLUMN org_id INTEGER REFERENCES cal_org(id);
ALTER TABLE host_booking ADD COLUMN person_id INTEGER REFERENCES cal_org_person(id);
ALTER TABLE host_booking ADD COLUMN subject TEXT;
ALTER TABLE host_booking ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
ALTER TABLE host_booking ADD COLUMN whole_centre INTEGER NOT NULL DEFAULT 0;
ALTER TABLE host_booking ADD COLUMN outside_place TEXT;
-- "to confirm" holds the space until this day (NULL: 7 days after it was made)
ALTER TABLE host_booking ADD COLUMN hold_until TEXT;
-- free (ticked by default), priced, or "price not set" (a booking made by Reception). NULL for our own activities.
ALTER TABLE host_booking ADD COLUMN price_state TEXT DEFAULT 'unset' CHECK (price_state IS NULL OR price_state IN ('free','priced','unset'));
-- with price_mode 'group': 1 = the amount is for EACH date of a repeating booking (0 = for the whole booking)
ALTER TABLE host_booking ADD COLUMN price_each INTEGER NOT NULL DEFAULT 0;
-- cancelled after money was received: keep all, give all back, or keep a part (the amounts kept). NULL: to decide.
ALTER TABLE host_booking ADD COLUMN cancel_money TEXT CHECK (cancel_money IS NULL OR cancel_money IN ('all','none','part'));
ALTER TABLE host_booking ADD COLUMN kept_usd REAL;
ALTER TABLE host_booking ADD COLUMN kept_syp REAL;
ALTER TABLE host_booking ADD COLUMN cancelled_by TEXT;
ALTER TABLE host_booking ADD COLUMN cancelled_at TEXT;
UPDATE host_booking SET price_state = CASE WHEN rate IS NOT NULL OR EXISTS (SELECT 1 FROM host_line l WHERE l.booking_id = host_booking.id AND l.amount > 0) THEN 'priced' ELSE 'unset' END;
-- one date of a booking cancelled, moved (to another day or other hours), or this date and the following cancelled.
-- taken = 1: left out when the series was saved, because the space was already held. Never deleted: undone = 1.
CREATE TABLE cal_date (
  id         INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES host_booking(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('cancel','move','cancel_from')),
  to_day     TEXT,
  time_from  TEXT,
  time_to    TEXT,
  reason     TEXT,
  taken      INTEGER NOT NULL DEFAULT 0,
  undone     INTEGER NOT NULL DEFAULT 0,
  who        TEXT,
  at         TEXT NOT NULL
);
CREATE INDEX cal_date_booking ON cal_date(booking_id);
-- every change of price is kept (free / priced / not set, the mode, the amount, the services)
CREATE TABLE cal_price_hist (
  id          INTEGER PRIMARY KEY,
  booking_id  INTEGER NOT NULL REFERENCES host_booking(id) ON DELETE CASCADE,
  price_state TEXT,
  price_mode  TEXT,
  price_each  INTEGER NOT NULL DEFAULT 0,
  rate        REAL,
  currency    TEXT,
  lines       TEXT,
  who         TEXT,
  at          TEXT NOT NULL
);
-- the price the 0.12 bookings already had is the first line of their history
INSERT INTO cal_price_hist (booking_id, price_state, price_mode, rate, currency, who, at)
  SELECT id, price_state, price_mode, rate, currency, created_by, COALESCE(updated_at, created_at) FROM host_booking WHERE price_state = 'priced';
`,
  },
  {
    n: 66,
    name: 'calendar: the new rights (Director, Coordinator, Reception, Team are ticks), carried over from the 0.12 hosting ticks',
    sql: `
-- (Fouad, calendar baseline 2.1, section 3) Each line of the table of rights is a tick the Superior can change.
-- Carried over: whoever saw the 0.12 calendar sees the new one; whoever booked gets the Reception ticks; whoever set
-- the prices gets the prices and payments; whoever kept the calendar (and the Superior) gets every tick.
UPDATE access_profile SET perms = replace(perms, ']', ',"cal.view"]') WHERE (perms LIKE '%"hosting.%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"cal.view"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"cal.contacts"]') WHERE (perms LIKE '%"hosting.book"%' OR perms LIKE '%"hosting.prices"%' OR perms LIKE '%"hosting.keep"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"cal.contacts"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"cal.programme"]') WHERE (perms LIKE '%"hosting.keep"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"cal.programme"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"cal.outside"]') WHERE (perms LIKE '%"hosting.book"%' OR perms LIKE '%"hosting.prices"%' OR perms LIKE '%"hosting.keep"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"cal.outside"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"cal.orgs"]') WHERE (perms LIKE '%"hosting.book"%' OR perms LIKE '%"hosting.prices"%' OR perms LIKE '%"hosting.keep"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"cal.orgs"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"cal.arrive"]') WHERE (perms LIKE '%"hosting.book"%' OR perms LIKE '%"hosting.prices"%' OR perms LIKE '%"hosting.keep"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"cal.arrive"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"cal.prices"]') WHERE (perms LIKE '%"hosting.prices"%' OR perms LIKE '%"hosting.keep"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"cal.prices"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"cal.money"]') WHERE (perms LIKE '%"hosting.prices"%' OR perms LIKE '%"hosting.keep"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"cal.money"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"cal.whole"]') WHERE (perms LIKE '%"hosting.keep"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"cal.whole"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"cal.setup"]') WHERE (perms LIKE '%"hosting.keep"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"cal.setup"%';
UPDATE access_profile SET perms = replace(perms, ']', ',"cal.history"]') WHERE (perms LIKE '%"hosting.keep"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"cal.history"%';
`,
  },
  {
    n: 67,
    name: 'calendar: the Accountant only sees the calendar (no accountant role in the calendar)',
    sql: `
-- (Fouad, 2026-11-23) Update 66 gave every calendar tick to whoever kept the 0.12 calendar, and in a centre that was the
-- Accountant too. The calendar has no accountant role: only the Superior keeps every tick; a role that kept the 0.12
-- calendar without managing users (the Accountant) keeps only "Sees the calendar". Its 0.12 ticks are not changed.
UPDATE access_profile SET perms = replace(replace(replace(perms, ',"cal.contacts"', ''), '"cal.contacts",', ''), '"cal.contacts"', '') WHERE perms LIKE '%"hosting.keep"%' AND perms NOT LIKE '%"users.manage"%';
UPDATE access_profile SET perms = replace(replace(replace(perms, ',"cal.programme"', ''), '"cal.programme",', ''), '"cal.programme"', '') WHERE perms LIKE '%"hosting.keep"%' AND perms NOT LIKE '%"users.manage"%';
UPDATE access_profile SET perms = replace(replace(replace(perms, ',"cal.outside"', ''), '"cal.outside",', ''), '"cal.outside"', '') WHERE perms LIKE '%"hosting.keep"%' AND perms NOT LIKE '%"users.manage"%';
UPDATE access_profile SET perms = replace(replace(replace(perms, ',"cal.orgs"', ''), '"cal.orgs",', ''), '"cal.orgs"', '') WHERE perms LIKE '%"hosting.keep"%' AND perms NOT LIKE '%"users.manage"%';
UPDATE access_profile SET perms = replace(replace(replace(perms, ',"cal.arrive"', ''), '"cal.arrive",', ''), '"cal.arrive"', '') WHERE perms LIKE '%"hosting.keep"%' AND perms NOT LIKE '%"users.manage"%';
UPDATE access_profile SET perms = replace(replace(replace(perms, ',"cal.prices"', ''), '"cal.prices",', ''), '"cal.prices"', '') WHERE perms LIKE '%"hosting.keep"%' AND perms NOT LIKE '%"users.manage"%';
UPDATE access_profile SET perms = replace(replace(replace(perms, ',"cal.money"', ''), '"cal.money",', ''), '"cal.money"', '') WHERE perms LIKE '%"hosting.keep"%' AND perms NOT LIKE '%"users.manage"%';
UPDATE access_profile SET perms = replace(replace(replace(perms, ',"cal.whole"', ''), '"cal.whole",', ''), '"cal.whole"', '') WHERE perms LIKE '%"hosting.keep"%' AND perms NOT LIKE '%"users.manage"%';
UPDATE access_profile SET perms = replace(replace(replace(perms, ',"cal.setup"', ''), '"cal.setup",', ''), '"cal.setup"', '') WHERE perms LIKE '%"hosting.keep"%' AND perms NOT LIKE '%"users.manage"%';
UPDATE access_profile SET perms = replace(replace(replace(perms, ',"cal.history"', ''), '"cal.history",', ''), '"cal.history"', '') WHERE perms LIKE '%"hosting.keep"%' AND perms NOT LIKE '%"users.manage"%';
`,
  },
  {
    n: 68,
    name: 'calendar and inventory: a space "can be booked" (one map of the centre)',
    sql: `
-- (Fouad, 23 November 2026, inventory baseline 1.1 rule 2) The calendar and the inventory share one map: the areas and
-- spaces. A space that cannot be booked (a store, an office, a storage room) is shown only in the inventory, never in the
-- calendar. Every space already there can be booked.
ALTER TABLE host_room ADD COLUMN bookable INTEGER NOT NULL DEFAULT 1;
`,
  },
  {
    n: 69,
    name: 'inventory step 1: one map of the centre (every place of the inventory is a space, every space is a place)',
    sql: `
-- (Fouad, inventory baseline 1.1, rules 1-2 and step 1) The inventory and the calendar keep ONE map: the areas and spaces.
-- Each space already has its place of the inventory (host_room.place_id, since 0.12). What was missing:
-- 1. a place of the inventory that is not a space (a store typed in the 0.12 inventory) becomes a space that cannot be
--    booked, in an area "Inventory places" made only if needed; the keeper may move it to its real area later. Its
--    place, its items and their history stay exactly as they were (same place id).
INSERT INTO host_building (name, sort)
  SELECT 'Inventory places · أماكن الجرد', COALESCE((SELECT MAX(sort) FROM host_building), 0) + 1
   WHERE EXISTS (SELECT 1 FROM inv_place p WHERE NOT EXISTS (SELECT 1 FROM host_room r WHERE r.place_id = p.id))
     AND NOT EXISTS (SELECT 1 FROM host_building WHERE name = 'Inventory places · أماكن الجرد');
INSERT INTO host_room (building_id, name, beds, kind, kind_id, capacity, active, sort, place_id, rentable, bookable)
  SELECT (SELECT id FROM host_building WHERE name = 'Inventory places · أماكن الجرد'), p.name, 0, 'other',
         (SELECT k.id FROM host_kind k WHERE k.sleeps = 0 ORDER BY (k.name = 'Other · أخرى') DESC, k.sort, k.id LIMIT 1),
         0, p.active, COALESCE((SELECT MAX(sort) FROM host_room), 0) + p.id, p.id, 0, 0
    FROM inv_place p
   WHERE NOT EXISTS (SELECT 1 FROM host_room r WHERE r.place_id = p.id);
-- 2. a space without its place (none should exist: saving a space makes one) gets one, named "Area · Space" as 0.12 did
INSERT OR IGNORE INTO inv_place (name, sort)
  SELECT b.name || ' · ' || r.name, COALESCE((SELECT MAX(sort) FROM inv_place), 0) + r.id
    FROM host_room r JOIN host_building b ON b.id = r.building_id WHERE r.place_id IS NULL;
UPDATE host_room SET place_id = (
    SELECT p.id FROM inv_place p JOIN host_building b ON b.id = host_room.building_id
     WHERE p.name = b.name || ' · ' || host_room.name AND NOT EXISTS (SELECT 1 FROM host_room r2 WHERE r2.place_id = p.id))
 WHERE place_id IS NULL;
`,
  },
  {
    n: 70,
    name: 'inventory step 1: categories with three ticks (serial, valuable, shown in the calendar); a group split in parts',
    sql: `
-- (Fouad, inventory baseline 1.1, section 3) Each category has three ticks: a serial number is expected (already there),
-- VALUABLE (a photo and a label are asked for its items), and SHOWN IN THE CALENDAR (its items appear in the calendar
-- as "always in the room"). To start: the categories that expect a serial number (IT, audio-visual) are valuable, and
-- audio-visual (projector, sound) is shown in the calendar. The keeper changes these ticks in the inventory's lists.
ALTER TABLE inv_category ADD COLUMN valuable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inv_category ADD COLUMN in_calendar INTEGER NOT NULL DEFAULT 0;
UPDATE inv_category SET valuable = 1 WHERE serial = 1;
UPDATE inv_category SET in_calendar = 1 WHERE name = 'Audio-visual · صوت وصورة';
-- A group (Chairs x60): when some move to another space it is split, the same label with a letter (HO-0102-A, HO-0102-B).
-- The new part remembers the item it came from.
ALTER TABLE inv_item ADD COLUMN split_from INTEGER REFERENCES inv_item(id);
`,
  },
  {
    n: 71,
    name: 'inventory step 1: seeing the values ($) is its own tick (the keeper and the Superior have it)',
    sql: `
-- (Fouad, inventory baseline 1.1, section 2) Looking at the inventory and seeing its values are two ticks: the values are
-- seen by the keeper and the Director (the Superior gives the tick to the Director's role). Whoever keeps the inventory,
-- and whoever manages the users, gets it. Reporting a problem needs no tick: everyone may report one. Centres only.
UPDATE access_profile SET perms = replace(perms, ']', ',"inventory.values"]')
 WHERE (perms LIKE '%"inventory.manage"%' OR perms LIKE '%"users.manage"%') AND perms NOT LIKE '%"inventory.values"%'
   AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'kind' AND value IN ('community', 'country', 'hr'));
`,
  },
  {
    n: 72,
    name: 'calendar: a kind of space may have no category (not in the calendar); the starting kind "Store"',
    sql: `
-- (Fouad, first test, 23 November 2026, calendar comment 1) A kind may have NO category: its spaces never appear in the
-- quick views of the calendar (Halls, Rooms...). Every centre gets a starting kind "Store" with no category. The kind is
-- marked with a code so the inventory finds it (its view "Stores") even when the keeper renames it.
-- If a kind named Store already exists (typed by hand), that one is used and its category taken away: no second kind.
ALTER TABLE host_kind ADD COLUMN code TEXT;
UPDATE host_kind SET code = 'store', category_id = NULL
 WHERE id = (SELECT id FROM host_kind
              WHERE lower(trim(name)) IN ('store', 'stores', 'store · مستودع', 'مستودع · store', 'مستودع', 'مستودعات')
                 OR lower(trim(name)) LIKE 'store ·%' OR lower(trim(name)) LIKE '%· store'
                 OR trim(name) LIKE 'مستودع ·%' OR trim(name) LIKE '%· مستودع'
              ORDER BY active DESC, id LIMIT 1);
INSERT INTO host_kind (name, sleeps, active, sort, category_id, code)
  SELECT 'Store · مستودع', 0, 1, COALESCE((SELECT MAX(sort) FROM host_kind WHERE sort < 99), 0) + 1, NULL, 'store'
   WHERE NOT EXISTS (SELECT 1 FROM host_kind WHERE code = 'store');
`,
  },
  {
    n: 73,
    name: 'inventory: a ready list of items for each kind of space (Quick add); the person who has an item chosen from MAGIS HR',
    sql: `
-- (Fouad, first test, 23 November 2026, inventory comment 1) Quick add by room: the table opens with the usual items of the
-- kind of space (a bedroom: bed, cupboard...), the keeper types how many. The lists start from the common names of the
-- inventory (only those), put by kind, with their category; the centre changes them in the inventory's settings. Centres only.
CREATE TABLE inv_ready (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind_id     INTEGER NOT NULL REFERENCES host_kind(id),
  name        TEXT NOT NULL,
  category_id INTEGER REFERENCES inv_category(id),
  sort        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind_id, name)
);
WITH r(kind, name, cat, sort) AS (VALUES
  ('Bedroom · غرفة نوم', 'Bed', 'F', 1), ('Bedroom · غرفة نوم', 'Cupboard', 'F', 2), ('Bedroom · غرفة نوم', 'Desk', 'F', 3), ('Bedroom · غرفة نوم', 'Chair', 'F', 4), ('Bedroom · غرفة نوم', 'Fan', 'A', 5), ('Bedroom · غرفة نوم', 'Heater', 'A', 6),
  ('Hall · قاعة', 'Chair', 'F', 1), ('Hall · قاعة', 'Table', 'F', 2), ('Hall · قاعة', 'Whiteboard', 'F', 3), ('Hall · قاعة', 'Projector', 'V', 4), ('Hall · قاعة', 'Screen', 'V', 5), ('Hall · قاعة', 'Microphone', 'V', 6), ('Hall · قاعة', 'Fan', 'A', 7), ('Hall · قاعة', 'Heater', 'A', 8),
  ('Classroom · صف', 'Chair', 'F', 1), ('Classroom · صف', 'Table', 'F', 2), ('Classroom · صف', 'Whiteboard', 'F', 3), ('Classroom · صف', 'Fan', 'A', 4), ('Classroom · صف', 'Heater', 'A', 5),
  ('Meeting room · قاعة اجتماعات', 'Chair', 'F', 1), ('Meeting room · قاعة اجتماعات', 'Table', 'F', 2), ('Meeting room · قاعة اجتماعات', 'Whiteboard', 'F', 3), ('Meeting room · قاعة اجتماعات', 'Screen', 'V', 4), ('Meeting room · قاعة اجتماعات', 'Fan', 'A', 5), ('Meeting room · قاعة اجتماعات', 'Heater', 'A', 6),
  ('Dining room · قاعة طعام', 'Chair', 'F', 1), ('Dining room · قاعة طعام', 'Table', 'F', 2), ('Dining room · قاعة طعام', 'Fridge', 'A', 3), ('Dining room · قاعة طعام', 'Fan', 'A', 4), ('Dining room · قاعة طعام', 'Heater', 'A', 5),
  ('Kitchen · مطبخ', 'Fridge', 'A', 1), ('Kitchen · مطبخ', 'Table', 'F', 2), ('Kitchen · مطبخ', 'Shelf', 'F', 3), ('Kitchen · مطبخ', 'Cupboard', 'F', 4),
  ('Library · مكتبة', 'Shelf', 'F', 1), ('Library · مكتبة', 'Table', 'F', 2), ('Library · مكتبة', 'Chair', 'F', 3), ('Library · مكتبة', 'Desk', 'F', 4),
  ('Chapel · كنيسة', 'Chair', 'F', 1), ('Chapel · كنيسة', 'Microphone', 'V', 2), ('Chapel · كنيسة', 'Fan', 'A', 3), ('Chapel · كنيسة', 'Heater', 'A', 4),
  ('Outdoor · ساحة خارجية', 'Chair', 'F', 1), ('Outdoor · ساحة خارجية', 'Table', 'F', 2),
  ('Office · مكتب', 'Desk', 'F', 1), ('Office · مكتب', 'Chair', 'F', 2), ('Office · مكتب', 'Cupboard', 'F', 3), ('Office · مكتب', 'Shelf', 'F', 4), ('Office · مكتب', 'Laptop', 'I', 5), ('Office · مكتب', 'Printer', 'I', 6),
  ('#store', 'Shelf', 'F', 1))
INSERT INTO inv_ready (kind_id, name, category_id, sort)
SELECT k.id, r.name,
       (SELECT c.id FROM inv_category c WHERE c.name = CASE r.cat WHEN 'F' THEN 'Furniture · أثاث' WHEN 'A' THEN 'Appliances · أجهزة كهربائية' WHEN 'V' THEN 'Audio-visual · صوت وصورة' ELSE 'IT equipment · معدات معلوماتية' END),
       r.sort
  FROM r JOIN host_kind k ON (k.name = r.kind OR (r.kind = '#store' AND k.code = 'store'))
 WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = 'kind' AND value IN ('community', 'country', 'hr'));
-- (inventory comment 4; baseline section 3) The person who has an item is chosen from the people of the centre in MAGIS HR
-- (typed only if not there): the item keeps the name and which person of HR it is ("<HR database>:<person>"), so the
-- keeper is reminded when that person leaves.
ALTER TABLE inv_item ADD COLUMN holder_ref TEXT;
`,
  },
];

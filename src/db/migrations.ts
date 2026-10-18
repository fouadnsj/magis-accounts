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
];

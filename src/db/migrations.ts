// Numbered schema migrations. Same discipline as the Catalogue project:
// a migration that has been applied is NEVER edited — write a new one.
// Each runs once, inside a transaction, and is logged in schema_migration.

export interface Migration {
  n: number;
  name: string;
  sql: string;
}

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
];

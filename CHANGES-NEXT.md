# For the next build (after 0.12.1) — list made 24 November 2026

Committed on `main` after the tag `v0.12.1`. Nothing is in an installer. **No new database update** (the last is still 63),
so upgrading from 0.12.1 changes nothing in the data.

## 1. Lists → Budget: choose the list a database follows
- A database that has **not taken from any list yet** (an imported file, for example the ready Al-Ard database) now shows
  **"The list this database follows"** with the server's published lists; choose one, then *Take from the main list…*.
  A database that already took lines from a list keeps it (no chooser).
- (It is also written at the end of `CHANGES-0.12.1.md`, but it was made after the 0.12.1 build: it is **not** in the 0.12.1 installer.)
- To check: import a database file that never took from a list → *Lists → Budget* → the chooser appears.

## 2. New entry: no "Project" field for an expense
- Fouad, 24 November 2026: the project of an expense is decided by its budget line — a funded line is in its project, a
  line not funded is outside the budget. The window no longer shows the *Project* list for an expense.
- An older expense that was put by hand on a project outside the budget (Deir) keeps it when it is changed.
- The *Project* field of an **income** stays as it is (for those who may record donors' money).
- The guide's sentence on expenses says the same (Arabic, English, French).
- To check: *New entry → Expense*: no Project field; choose a heading and a line and save; *Reports → By project* shows it in the line's project.

## Not in the installer (tools only)
- `scripts/alard-build.ts`: makes the ready Al-Ard database, following the main list "Al Ard".

## Being prepared, not built
- The new **Calendar**: the concept is final (`calendar-plan/CALENDAR-BASELINE.md`, summary `calendar-plan/CALENDAR-SUMMARY.html`);
  building has not started. It will not be in the next build unless it is finished first.

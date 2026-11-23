# For the next build (after 0.12.1) — list made 24 November 2026

Committed on `main` after the tag `v0.12.1`. Nothing is in an installer. **Four new database updates: 64, 65, 66, 67** (the
calendar's foundation, §3). They only add: nothing of 0.12.1 is changed or removed (rehearsed on copies of the 0.12 test data).

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

## 3. The new Calendar — step 1 "Foundation" (data and rules only, no new screen yet)
Concept: `calendar-plan/CALENDAR-BASELINE.md` (2.1, final) §10 step 1. Rules in `src/hosting/calendar.ts`, operations
`cal.*` in `src/hosting/calops.ts`, tests in `tests/calendar.test.ts`.
- **Database updates 64–67.** A 0.12 building is now an **area**, a room a **space** (floor, rentable or ours only, what is
  always in it, note). **Categories** Halls and Rooms (more can be added, e.g. Playground); new kinds of space: kitchen,
  library, chapel, outdoor, office. Lists: kinds of activity (7, with colours), kinds of organisation (8).
  **Organisations** with several persons in charge. Bookings are **ours** or **outside**; leader, private tick, whole
  centre, outside the centre, "to confirm" held until a date, free / priced / "price not set", the money kept when
  cancelled. **Dates moved or cancelled** (kept, never deleted), **spaces closed for repairs**, **closed periods**,
  **price history**.
- **The rules:** a space is never given twice ("to confirm" holds too; one group per bedroom); a weekly series with taken
  dates is refused, or saved without them (listed and kept); a closed space cannot be booked; Sunday (outside hall
  bookings), closed periods, capacity and equipment are warnings; the whole centre holds every space; an outside group only
  in rentable spaces, a stay only in bedrooms; Reception's bookings are "price not set"; the Team sees a private booking as
  "Reserved" and no phone; no amount without the prices or money tick.
- **New ticks** (Admin → roles, group "Calendar"): see, contacts, our programme, outside bookings, organisations,
  arrived/left, prices, money, whole centre and repairs, spaces and lists, history. Carried over from 0.12: whoever saw the
  0.12 calendar sees; whoever booked gets the Reception ticks; the prices tick gets prices and money; the Superior gets
  every tick. **The Accountant only sees the calendar** (Fouad, 23 November: there is no accountant role in the calendar;
  update 67): any role that kept the 0.12 calendar without managing users keeps only "Sees the calendar". Its 0.12 ticks
  are not changed. The Superior can change each tick.
- The Excel file `MAGIS-Calendar-spaces.xlsx` is **not used** (Fouad, 23 November: not practical): the spaces will be typed
  in the program. (A reading of its sheets exists, unused.)
- Fouad confirmed (23 November): the Sunday warning only for outside hall bookings; closing a space over bookings lists them
  first, then a second "save anyway".
- The 0.12 calendar screen still works with its own rules until step 2 replaces it. Payments stay as in 0.12 (step 4).
- To check: nothing to see yet in the program except the new ticks in Admin → roles. Step 2 is the laptop screen.

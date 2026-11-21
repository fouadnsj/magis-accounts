# What is new in 0.12.0 — list made 22 November 2026

Everything below is committed on `main` after the tag `v0.11.4`. **Nothing is in an installer yet**: build only when Fouad
says "build". Three new database updates (58, 59, 60); each database is copied before it changes, as always.

## 1. Accommodation and calendar (a new section, per centre)
- **Switched on per centre** in *Admin → Sections* (off by default). The *Inventory* has the same switch (on by default).
- **Buildings and rooms.** A building has rooms with beds, or halls. Each room is also a place of the inventory.
  Each building has a **colour** (one you choose, or one of eight ready ones).
- **The calendar**, in three views plus a filter:
  - *Rooms by day*, with the building's colour: solid = confirmed, hatched = to confirm, white frame ✓ = arrived,
    grey = left, red = clash.
  - *Month*: each day with the share of beds used and the groups present. *Year*: twelve small months shaded by how full.
  - **Drag over days (and over several rooms)** to start a booking with them already chosen.
  - A filter by type: *accommodation / events / all*.
- **Bookings.** A stay (nights) or an **event in a hall** (days, with hours). Statuses: to confirm → confirmed → arrived →
  left, or cancelled with a reason. Beds are shared in a room; two groups can use one dormitory until it is full; the day
  of leaving is free for the next group. A booking whose rooms clash with a confirmed one cannot be confirmed.
- **Weekly repeating events** (events only, never a stay): the weekdays you choose between two dates, like the website.
  Two events in one hall on one day only clash if their hours cross.
- **Price and services.** Per person per night (usual) or a fixed price for the group. Meals, breaks, logistics, heating…
  come from a list you edit, each with its **own amount and currency (USD or SYP)**. The total and what is still due are
  shown per currency.
- **Payments are suggestions of entries.** A payment received gets a receipt number (H2027-0001); the accountant makes it
  an Income entry in the register (the form opens filled in) or refuses it. The number links the two.
- **Clearer save buttons**: *Save as "to confirm"* / *Confirm the booking* / *Save the changes*, with a line explaining
  that "to confirm" holds the days but is not final.
- **Groups and people in charge are remembered** from the bookings: names are completed while typing, a known group fills
  its person in charge and phone, and shows "N earlier booking(s)". (No separate list: the same name = the same group.)

## 2. Reports (Calendar → Reports)
- Period (this year, last year, all time, dates), type, with or without the bookings still "to confirm".
- Cards: bookings, groups, nights, person-nights, bed occupancy, event days, hall use, and the agreed and received amounts.
- **The busiest months** as bars (choose bed %, person-nights or bookings; the busiest is marked ★); click a month to see
  **its days** as a heat grid, **the busiest days**, and **the weekday pattern** (average occupancy by weekday).
- Tables by building, by **group** (bookings per group, click to list them) and by **person in charge**.
- **Excel**: Summary, By month (ranked, with a colour scale), **Busiest**, **By day** (one row per day, filter, colour
  scale), By building, Groups, People, Bookings. No amounts for those who do not see prices.

## 3. The phone
- **Calendar with no connection**, in three views: **Day** (opens first: today, beds taken, who arrives and leaves, each
  room with its groups or *free +*), **Week** and **Month**; building colours; building filter.
- **A booking made with no connection is always "to confirm"**; it is never made twice. At the connection a window shows
  each booking: no clash → *Confirm*; a clash → names the group it runs into, gives the phone number to **call**, and lets
  you **change the dates or the rooms**. The same window appears on the computer.
- Names of groups and people are completed on the phone too. No amount ever reaches the phone.
- Fixed: tapping *free +* used to blank the screen.

## 4. Who sees what
- **Four ticks** for the hosting group in the roles: *Sees*, *Makes bookings*, ***Sees and sets the prices and the
  payments*** (new, its own tick), *Keeps the calendar* (buildings, rooms, services). The Superior decides, role by role,
  who sees the prices. **Without that tick nobody sees an amount** (on screen, on the phone, in Excel); this is enforced
  on the server. The Superior and the Accountant have all four.
- **People with no book can work** with the calendar and the inventory (a receptionist, a stock keeper): their Home offers
  *Calendar and bookings* and *Inventory*; no Register in their menu; the calendar opens on their phone.
- **Another person can keep the inventory** (not only the accountant): he gets the purchases on inventory lines from the
  server (date, amount, bill) so *To register* works, without seeing the rest of the register.

## 5. Al-Ard's farm list
- *Admin → Sections → Add the farm's list*: 3 headings and 15 lines (farm sales: table olives, olive oil, quince, grapes,
  apricots, almonds; non-farm income: camps; running costs: fixed salaries, machine maintenance, fuel, alternative energy,
  daily and seasonal labour, fertilizers, insecticides). Pressed twice, nothing is doubled; changed later as needed.

## 6. Other
- A guide page *Accommodation and calendar*; a checklist (`TEST-2026-11-14.md`, section 18); this list.
- The full test suite passes (new tests in `tests/hosting.test.ts`, one in `tests/inventory.test.ts`).

## Rehearsal on copies of the real databases (22 November 2026, done by me)
Copies of the real Homs (11 Nov, schema 49) and Aleppo (30 Oct, schema 35; and the new November one) were upgraded with
this version, in a temporary folder: 11 to 25 updates applied in about 40 ms; **every row of every table is still there**,
the entries are **identical** (checked by a fingerprint of all columns they had before); the database integrity check and the
foreign-key check pass; the program opens each file as each of its people (Superior, Accountant, book holders) and answers;
the Superior and the Accountant received the new ticks and the book holders none. Through the real server program the
same happened: a `before-update` copy of each database (same size as the original), the upgrade, a daily backup.
What you will see on real data: Homs shows **12 purchases to register** in the Inventory (the furniture and equipment lines
are ticked by name); the calendar is off until switched on; Aleppo shows none.
Not rehearsed: the real server's other databases (HR, communities) and anything newer than those copies; the Windows
installer itself. See `../test-servers/REHEARSAL-ON-REAL-DATA.md` to rehearse on a fresh copy.

## Still to check on your side (not done by me)
- The Excel file opened in Excel (the colour scales and the six-plus sheets).
- The phone on a real Android: offline booking, then connection, then the review window; the Day/Week/Month views.
- A real reception role with no book, on a computer and a phone; a stock keeper with no book.
- Dragging over days with a mouse in the Windows app (tried only in the browser).

## Not done (kept for later)
- Salaries as suggestions to the accountant (needs a send from the HR database to the centre's database).
- A public page for groups to ask for a date.
- The calendar for the Coordinator; merging two spellings of one group.
- The idea of the central server fed by the centres' backups: `IDEA-WEB-APP-AND-CENTRAL-SERVER-2026-11-22.md`.

## For the build itself (when he says "build")
- Version 0.12.0 in the 5 files (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`, `server/server.ts`), tag `v0.12.0`, push, Mac dmg, GitHub builds the Windows installers, then a
  new `installers-0.12.0` with its `INSTALL-README.md` and `desinstaller-mac.command`.
- The upgrade of the real server (0.7.4): rehearse on a **copy** first.

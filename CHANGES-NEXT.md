# For the next build (after 0.12.1) — list made 24 November 2026

Committed on `main` after the tag `v0.12.1`. Nothing is in an installer. **Eight new database updates: 64 to 71** (the
calendar's foundation, §3, the "can be booked" tick, §4, and the inventory's step 1, §5). They only add: nothing of 0.12.1 is changed or removed (rehearsed on copies of the 0.12 test data).

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
- To check: the new ticks in Admin → roles.

## 4. The new Calendar — step 2 "Laptop screen"
A door **"New calendar · التقويم الجديد"** in the menu for whoever has a calendar tick (the real door comes in step 8; the
0.12 calendar stays where it was). Files: `src/ui/Calendar.tsx`, `src/ui/CalSettings.tsx`, `src/hosting/calview.ts`.
- **Settings** (⚙, for the Director): areas and their colours; spaces (kind, capacity or beds, floor, rentable or ours
  only, what is always in it, note, own category); kinds of space and their categories; kinds of activity (colours);
  kinds of organisation; closed periods; spaces closed for repairs (bookings already there are listed first).
- **The bar**: ‹ Today ›, Day / Week / Month / List, the area, the search, + New. **Quick views**: Everything and each
  category (Halls, Rooms…), kept per person.
- **The Today strip**: arrive today, leave today, halls in use now, rooms free tonight, to confirm (held dates passed in
  red); each tile opens its list with its buttons (mark arrived / left, book a free room, confirm).
- **Week** (spaces by area, an area can be folded; stays as bars across the nights; a line "outside the centre"), **Day**
  (08:00–22:00 by hours, a red line for now), **Month** (all the day's events in its box, how busy it is), **List**
  (upcoming, in the house, to confirm, past). Closed periods as a band, closed spaces hatched. Week from Monday, digits 0–9.
- **Drag to book**: over days and spaces (week), over hours and spaces (day), over days (month) → the booking window with
  everything selected filled in. A booking's window shows it, with Change, Confirm, Arrived / Left, Move this date, Cancel
  this date (or this date and the following), Put back, Cancel the booking (with the reason).
- **The booking window, first version**: our activity / outside booking / whole centre; who (kind, title, leader; or the
  organisation, a new one in the window, and the person for this booking); where (spaces by area, or outside the centre);
  when (one day, several days, every week on chosen days; hours in 15-minute steps with morning / afternoon / evening);
  status with the date held, private, note. A space already held: not possible (a weekly series: "Save without these
  dates"); warnings: "Save anyway". **Price, services and equipment come in step 3** (what a booking already has is kept).
- **"Can be booked"** (database update 68; inventory baseline 1.1 rule 2, Fouad's yes): a tick on each space in the
  settings. A space that cannot be booked (a store, an office, a storage room) is shown only in the inventory, never in
  the calendar: not in its views, not in the booking window, not held by the whole centre, not in the Today counts.
  Every space already there can be booked. A space with bookings to come cannot be unticked until they are moved or
  cancelled.
- Tried in the side pane on a copy of the 0.12 test data.

## 5. The new Inventory — step 1 "One map" (data and rules only, no new screen yet)
Concept: `inventory-plan/INVENTORY-BASELINE.md` (1.1, final) §9 step 1. Rules in `src/inventory/map.ts`, operations in
`src/inventory/ops.ts`, tests in `tests/inventory-map.test.ts`.
- **One map of the centre** (database update 69): the inventory and the calendar share the same areas and spaces. Every
  space was already a place of the inventory; now every place of the 0.12 inventory is also a space. A place that was not
  a space (a store typed in the 0.12 inventory) becomes a space that **cannot be booked**, in an area **"Inventory places ·
  أماكن الجرد"** (made only when needed); it can be moved to its real area in the calendar's settings. Its items and their
  history keep their place. A place added in the inventory becomes such a space too; a space shown in the calendar is
  changed only in the calendar's settings. The phone's list of places uses the names of the map.
- **Categories with three ticks** (update 70): serial number expected (as before), **valuable** (a photo and a label are
  asked) and **shown in the calendar**. To start: IT equipment and Audio-visual are valuable; Audio-visual is shown in the
  calendar. The keeper changes them in the inventory's lists.
- **A group that splits**: when part of a group moves (Chairs ×30 of ×60), it is split, the same label with a letter:
  A stays, B moves (HO-0102-A, HO-0102-B); a part split again keeps its letter and the new part takes the next one. Each
  part keeps the purchase, the value of one unit and the photos; both histories say what happened; an old sticker still
  finds every part. Moving the whole item keeps its label.
- **"Always in the room" in the calendar** is read from the inventory: the items of the space whose category is ticked
  "shown in the calendar", with how many. While the inventory has nothing of the kind for a space, the text typed in the
  calendar's settings is still shown (nothing is lost before the keeper lists the items). The calendar's screens show it
  in their next step.
- **New tick "Sees the values of the inventory ($)"** (update 71): given to whoever keeps the inventory and to the
  Superior; the Superior gives it to the Director's role. Who only looks receives the items without any amount.
  **Reporting a problem needs no tick**: everyone may report one (the button comes in step 3).
- The 0.12 inventory screen is not changed (it is not used meanwhile). Rehearsed on copies of the 0.12 test data, the
  inventory check data and the real copies (Homs, demo, a community, HR, Syria): items, history, places and bookings
  unchanged.
- To check (with step 2's screens): the map, a store in "Inventory places", moving part of a group.

## 6. The new Calendar — step 3 "The windows"
- **The booking window** (our activity, outside booking, whole centre) now has, in order: who · where · when ·
  **equipment needed** (from the list taken from the inventory, with how many; a warning if bookings at the same time ask
  for more than the inventory holds) · **services** (meals, coffee break…: how many; the amounts only for the Director and
  the Coordinator) · **price** (Director, Coordinator: the **"free" tick, ticked by default**; untick for an amount in USD or
  SYP, **per person per night** for a stay, **for the whole booking**, or **for each date** of a booking that repeats or
  lasts several days; the agreed total shown at once; every change kept in the history) · status, private, note.
  Reception does not see the price: its bookings are saved "price not set", and the window says so; when the Director or
  the Coordinator opens such a booking, a line asks them to decide free or a price.
- **The organisation window**: name, kind, note, **several persons in charge** with their phones (a person is switched
  off, never removed), switched off rather than deleted; opened from the booking window (✎ and ＋) or from the
  **Organisations** register in the bar (search by name, person or phone; how many bookings each).
- **Always in the room** is read from the inventory (inventory step 1), or the text typed in the settings while the
  inventory has nothing for that space: shown in the booking window under the chosen spaces, in a booking's window and as
  a tip on the spaces of the week and the day.
- Settings → Lists: the **services** and the **equipment** a booking can ask for (names taken from the inventory).
- "For each date" also for a booking of several days in a row (not only weekly).
- Tried in the side pane on the copy: an organisation with two persons; a hall booking at 50 USD with a service at
  20 USD (total 70 USD), saved and opened again with its price.

## 7. The new Inventory — step 2 "The screens"
A door **"New inventory · الجرد الجديد"** in the menu for whoever looks at the inventory (the real door comes in step 5;
the 0.12 inventory stays where it was). File: `src/ui/InvHome.tsx`. No database update.
- **Home = the map of the centre**: each area (with its colour) and a card per space: the photo of something in it, how
  many items, the value (only for who sees the values), the last count, what needs attention, "not booked" for a store.
- **Figures on top**: items and units, value (with the values tick), purchases to register (keeper), to repair or
  broken, with staff, valuable items still without a photo or serial (keeper). A figure opens its list.
- **Quick views**: Map · By place · By category · All items · With staff; a search (label, name, serial, person; an old
  label finds every part of a split group). "+ Item" for the keeper.
- **A space**: the photos of what is in it, then the list; Items, Value, Last count, Attention, "Always in the room" (from
  the inventory, else the typed text) and the calendar's bookings of the week in that space (for who sees the calendar).
  Buttons for the keeper: **Count this space** (every item seen today) and **Move items…** (how many of each; part of a
  group splits: A stays, B moves). The **sheet for the door** comes with the printed pages (step 4).
- **An item**: photos (add / remove for the keeper), details, value (with the tick), origin, the other parts of its group,
  the **history** (with the group's history before it was split), the link to the **books** (date, bill, supplier,
  heading › line; the entry's amount with the values tick) and to the **calendar** (the bookings to come, 60 days, that
  ask for equipment of that name). Buttons: Move, Change (the item window of 0.12), Label.
- Who only looks (no values tick) sees no amount anywhere, no "+ Item", no purchases to register.
- Tried in the side pane on a copy of the 0.12 test data (Homs): the map with "Inventory places", Store 1's page, moving
  1 of 2 coolers (HOM-0001-A stays, HOM-0001-B moves), the item page with its history, and Rima (Reception) without values.
- Not yet: problems reported and "with a staff member" from the HR list (step 3); printed pages and the donor report
  (step 4); the project of a purchase on the item page (with the donor report, step 4).

## Not in the installer (tools only)
- `scripts/alard-build.ts`: makes the ready Al-Ard database, following the main list "Al Ard".

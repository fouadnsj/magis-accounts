# For the next build (after 0.12.1) — list made 24 November 2026

Committed on `main` after the tag `v0.12.1`. Nothing is in an installer. **Twelve new database updates: 64 to 75** (the
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

## 8. The new Calendar — Fouad's first-test comments (TEST-COMMENTS-1.md, "Calendar" 1–4)
- **A kind of space may have "No category (not in the calendar)".** The kind window offers it. The spaces of such a kind
  never appear in the quick views (Halls, Rooms…). A new space of such a kind starts as "cannot be booked".
- **A starting kind "Store · مستودع"** with no category in every centre (update 72). If a kind named Store / مستودع was
  already typed (as in the test copy), that one is used and its category taken away: no second kind. The kind carries a
  mark (`code = 'store'`) so the inventory's view "Stores" finds it even if it is renamed.
- **The booking view, readable in one look:** a coloured head with the name and the state (Confirmed / To confirm + held
  until, red when passed); one block of the big facts (days, hours, spaces, people); one block "who" (organisation,
  leader, person, phone to call); one block money (free or price, agreed total, paid, left) with the services and the
  equipment; the buttons in two groups: "The whole booking" (Change, Confirm, Cancel the booking) and "Only this date
  (Wed 25)" (Move this date, Cancel this date only, This date and the following). Reception sees the services and the
  equipment, never the amounts.
- **"Organisations" moved to the end of the bar**, away from "New".
- **Calendar ↔ Settings easy to see:** on the calendar a clear button "⚙ Calendar settings"; in the settings the title
  "Calendar › Settings" (the word Calendar can be clicked) and a button at the top "Back to the calendar".
- Update **72** rehearsed on copies only (the 0.12 Homs copies, Al-Ard, the test copy with its typed "Store").

## 9. The new Inventory — Fouad's first-test comments (TEST-COMMENTS-1.md, "Inventory" 1–4, and the Settings ↔ map)
- **Quick add by room, with a ready list.** The table of the 0.12 Quick add (Enter = the next row, the common names, the
  origin, blank numbered labels, the Excel template) is now in the new inventory:
  - on each **space page**, "⚡ Quick add": the space is already chosen, and the table opens with the **usual items of that
    kind of space** already in rows (a bedroom: bed, cupboard, desk, chair, fan, heater…), the number empty. Type the
    numbers and record once; a row left empty or at 0 is skipped;
  - on the **map's home**, "⚡ Quick add": the space is chosen on each row.

  The category ticks apply: "serial number" shows the serial box (highlighted), and "valuable" marks the row 📷🏷 (a
  photo and a label to add later).
- **The ready lists** are edited in the inventory's Settings, kind by kind (add, remove, order, category). They start
  (update **73**) only from the common names already in the program, put by kind, with their category (Furniture,
  Appliances, Audio-visual, IT). The kinds of space themselves stay in the calendar's settings. The kind of a space that
  is only in the inventory (a store, an office) can be chosen on its page.
- **The serial number only where needed:** in "Register a purchase", in Quick add and in the item window, the serial box
  shows (highlighted) only when the category has the tick "serial number". An item that already has a serial number
  still shows it.
- **The quick view "Stores · المستودعات"** beside Map / By place…: only the spaces whose kind is the store kind. The kind
  is found by its mark, not its name, so Fouad's typed "Store" counts. Each store is shown with what is in it.
- **The person who has an item comes from MAGIS HR:** "With a person" offers the people of the centre in HR (names only,
  from the server); a name not in HR can still be typed. The item remembers which HR person it is (update 73,
  `inv_item.holder_ref`). **When that person leaves in HR**, the keeper sees a red tile "with someone who left: take
  them back", and the item page and the "With staff" list say "left" with the date. (On a laptop that is not connected
  to a server there is no HR list: the name is typed, as before.)
- **Inventory ↔ Settings easy to see,** as in the calendar: a button "⚙ Inventory settings"; in the settings the title
  "Inventory › Settings" (Inventory can be clicked) and a button at the top "Back to the inventory". The categories in
  the settings now also have the ticks "Valuable" and "In calendar".
- Update **73** rehearsed on copies only: the 0.12 Homs copies, the real-data copies and the first-test copy (with
  Fouad's typed "Store", space 101). Nothing that was there changed; each centre got 51 ready rows; a community, the
  country and HR got none.

## 9. The new Calendar — step 4 "Money and paper" (update 74)
- **Payments**, by the Director or the Coordinator, at any time, **also before confirming** (an advance): "＋ A payment
  received" in the booking view (amount, currency, date, cash / transfer / other, note). Each is a **suggestion for the
  books** with its receipt number (H2026-0001…), as in 0.12; it can be taken back (shown struck through) until it is an
  entry of the books. The booking view lists its payments with their state (waiting for the books / in the books).
- **Cancelling with money received**: a window with the reason and the three choices (keep all, give all back, keep a
  part with the amount typed per currency); it can be decided later ("Decide"). **What is given back is a suggestion for
  the books too: an expense numbered HR2026-0001…** (the books' Payments tab makes an expense of it, and an income for the
  others). Decided again, it is replaced; once it is an entry of the books it cannot change, and the booking cannot be put
  back. A booking put back "to confirm" undoes the decision and the waiting amounts.
- **Receipts (وصل استلام / Receipt, never invoice):** the whole booking's receipt keeps the 0.12 window (lines, currency
  and rate, preview, two logos) and now carries **the amount in words, Arabic and English** (words.ts), **two places to
  sign** ("Received by / Paid by"), and the mark **"COPY"** when printed again (counted by the program). New: **a receipt
  for each payment** with the same number as in the books (🖨 on each payment line). The calendar gives the receipt its own
  lines (price per person per night / each date / whole booking, then the services) and its own count of dates.
- **Printed pages** (a "🖨 Print" button in the bar, with a preview): a **short page for a week or a day** (reception,
  guard: each day, hours, spaces, people, phone, arrivals and leavings), **the week of one hall** (landscape, for its door),
  and in the booking view **the booking sheet for the group** (same look, two logos; amounts only for who sees them and
  never for a free booking). **Excel**: the list of the bookings of a period, and for who sees the money a sheet of the
  payments (received and given back, in the books or not). Reception gets no amounts anywhere.
- Update **74**: `host_pay.kind` ('in' / 'back'), `host_pay.printed`, `host_booking.receipt_printed`. Rehearsed on copies
  only (Al-Ard, the 0.12 Homs copies, the test copy): nothing changed, integrity ok. The 0.12 hosting page keeps working
  and its receipt window is shared (moving the pages to one drawing helper: `src/io/pdfCanvas.ts`).

## 10. The new Inventory — step 3 "Problems reported" (update 75)
- **One button, "⚠ Report a problem · أبلغ عن مشكلة",** for anyone of the centre (no tick): what is wrong, where (the space
  names are suggested; a name typed exactly as a space is linked to it), a photo if they can. It is in the laptop menu (and
  in the light phone window, small), in the new inventory's bar, and in the full phone app (not in the calendar-only phones).
  The window also shows **My reports**.
- **It goes to the keeper's list:** the menu "New inventory" carries a number, the home has a tile **"problems reported"**
  and a list (photo, what, where, who, when, state). The keeper opens one, may choose **the item concerned**, and sets the
  state: **Needs repair / Broken / Nothing wrong / Fine (repaired)**, with a word for the person if wanted. The item's state
  and its history are updated (nothing changes for "Nothing wrong").
- **The person then sees "seen by the keeper"** with the new state (and the item and the word), in My reports on the laptop
  and on the phone. Reports are kept 90 days on the screens.
- **On the phone** a report is kept with no connection and sent with the next sync, never twice (its own number). The phone's
  pack carries the spaces and the person's own reports with the answers.
- **Fouad's answers to the old questions:** (1) the starting ticks stay as they are since update 70 (valuable: IT and
  Audio-visual; shown in the calendar: Audio-visual only), applied once to databases that had none, and editable in the
  inventory's settings: nothing overwrites a centre's choice afterwards; (2) the area keeps its name "Inventory places ·
  أماكن الجرد"; (3) **the Coordinator's inventory page no longer shows any value** (nor does the server send it).
- Update **75** rehearsed on copies only (the first-test copies and the 0.12 copies): nothing else changed.

## 11. The new Inventory — step 4 "On paper and for the donors" (no database update)
- **Sheet of a space, for its door:** on a space's page, "🖨 Sheet for the door": the name of the space, what is in it (label,
  item, quantity, category, state if not good), the date and the last count. **No values.** Arabic and English, the two logos
  (the look of the calendar's receipts). Anyone who looks at the inventory may print it.
- **List for counting, space by space:** on the home "☑ Counting list" (choose the spaces, one page each) and on a space's page
  (that space): label, item, quantity, serial, last count, a box to tick what you see, a line for what is not found, and
  "Counted by / on". For the keeper. **Labels (QR) as today**, and also all the labels of a space from its page.
- **Report for a donor, "What a project bought":** on the home "📄 Report for a donor" (for whoever sees the values): choose the
  project and the months (the project's own dates when it has them); the items bought with the entries of that project (the
  fund of an expense comes from its budget line) dated in those months, never an entry of a private book. A **PDF with
  photos** (landscape: photo, label, item, space, quantity, purchase date, receipt, supplier, budget line, value, then
  the totals and "By space") and an **Excel** (Summary, Items with brand, model, serial, state, By space). The donor and
  contract come from the project's grant when there is one. The window warns when purchases of the project in that period are
  not yet items ("not in the report").
- Words: "Receipt" (never invoice), "prepare" the pages.
- Tried in the side pane (the windows, the buttons); the pages drawn from sample data and looked at. No database update.

## 12. The new Calendar — step 5 "Calendar phone" (update 76)
- **A calendar phone is not the full phone app.** It has no account and no sign-in: a manager at the centre (the Director, who has
  "Sets up spaces and lists", or whoever manages the users) opens Calendar → Settings → **Calendar phones** → "Link a phone",
  gives it a **name** and a **role** (Team, Reception, Coordinator, Director) and gets a **link code** (XXXX-XXXX). The code works
  **once** and for **30 minutes**; the server keeps only its hash.
- **On the phone:** open the phone page with `#calendar` at the end (`https://…/phone.html#calendar`; the start page says so),
  type the link code, then choose a **code of 4 digits** (typed twice). The server never knows that code: it locks the phone's
  key on the phone. Five wrong codes make the phone wait 30 seconds; "I forgot the code" forgets the phone (a new link code is
  needed). It locks again after 5 minutes out of sight. It then opens **straight on Today**.
- **Screens (read only):** Today (arriving, leaving, rooms free tonight, the day's activities and the guests), Week (Monday to
  Sunday), Spaces (each space free, used or closed, for a day). Tapping a booking shows it. The **last view is kept** (and the
  day, until the next morning). Arabic, English, French; digits 0–9.
- **What it keeps:** 1 month back and 6 months ahead (from the day it was updated), with the closed periods and the spaces closed
  for repairs. It says **"Updated 2026-11-23 22:09, from … to …"**. With no connection it shows what it kept and says so; the
  ↻ button updates it.
- **What it never receives:** prices, payments, price history, services, who cancelled and why (the server cuts them in
  `src/hosting/calphone.ts`; tested). **Contacts** (person in charge, phone, organisations) only on Reception, Coordinator and
  Director phones. A booking marked **private** shows only "Reserved · محجوز" on every phone.
- **The manager** sees each phone (name, role, linked on, last update), can rename it, change its role, or **cut it off** at once
  and for good (a phone cut off is told so on its next update and forgets the calendar it kept). Everything is in the history.
- Update **76**: one new table, `cal_phone` (id, name, role, link code hash and its end, key hash, who and when, last update, cut off).
  Rehearsed on copies only (the 0.12 and first-test copies): nothing else changed, integrity ok.
- Server: `/api/calphone/link` and `/api/calphone/pack` (`server/calphone.ts`); wrong link codes count in the same limit as
  the sign-in (8 tries, then 5 minutes).
- Tried in the side pane: link code made, the phone linked with it (once), Today / Week / Spaces, a booking opened with the contact
  on a Reception phone, locked on opening, a wrong code refused, the last view kept, then cut off: the phone is told and returns to
  the linking screen. Not tried: a real phone, the Arabic screen of the phone, the home-screen icon, an offline start.

## 13. The new Calendar — step 6 "To prepare today" (no database update)
- **Made by the program from the bookings; nobody types it; everybody who sees the calendar sees it** (Team, Reception,
  Coordinator, Director). Words: "prepare", never "clean"; there is no cleaner role.
- **Halls and kitchens** (every space with no beds): before the **first** activity or booking of the day there, with its hour,
  the group, the people and **what the group asks for** (equipment and how many). **Bedrooms**: for each group **arriving** today;
  and **ready again** after each group **leaves** today (the rooms it slept in).
- Nothing for a cancelled booking, a group marked left, a space closed for repairs that day, or a space outside the calendar
  (a store). Halls come first by hour, then arrivals, then rooms after a departure.
- **Laptop:** a new tile "To prepare today" in the Today strip (the number of things); it opens the list, each line opens its
  booking. **Phone:** a card "To prepare" at the top of Today (and of any day looked at). Read only.
- The "done" tick is **later**, as the baseline says. Update 77 is **not used** (no database change); the next free update is 77.
- Tried in the side pane: the tile appears; with a hall activity today at 15:00 the list shows "Hall A · before 15:00 · 12 people ·
  Morning class". The phone card uses the same function (tested in `tests/calview.test.ts`); not looked at on a phone screen.

## 14. The new Calendar — step 7 "TV screen, plain version" (no database update)
- **A page for the TV in the centre: `/tv`** on the centre's server (the https address of the computers), for any browser, nothing to
  install. It shows **today's halls, hall by hall, from 08:00 to 22:00**: each group as a block with its hours and the number of
  people, a red line for now, a clock, the day, the name of the house, a gold band in a closed period (holidays), "Closed · مغلق" on
  a hall closed for repairs, a dashed paler block for "to confirm". Under it: our activities outside the centre (what and where) and
  the groups staying in the house (names only). It refreshes itself **every minute**; with no connection it keeps the last screen
  and says so. Bedrooms are not rows (they are in "In the house").
- **What it never shows:** prices, payments, contacts, phones, notes, leaders, history. A booking marked **private** shows only
  "Reserved · محجوز". The server makes the small screen itself (`src/hosting/caltv.ts`, cut like a Team phone whatever role the TV
  was given), so the TV receives nothing else. Outside bookings appear under the organisation's name, as on the phone.
- **Linking:** the same way as a calendar phone: in the calendar settings the Director adds a "phone" (for example "Entrance TV",
  role Team), gets a link code, types it once on the TV's page `/tv`. The TV keeps its key in the browser (no 4 digits: it must
  start by itself after a power cut). The manager can cut it off like a phone; the TV then returns to the link screen.
- Server: `/api/tv/link` and `/api/tv/screen` (`server/calphone.ts`, `server/tv-page.ts`); wrong codes count in the same limit.
- Tried in the side pane on a **new empty test database** (not a copy of real data): link code typed, the screen drawn with two
  halls, a private talk shown as Reserved, a used code refused. Not tried: a real TV, an old TV browser, the day change at midnight,
  the red "now" line (tried at night only), many groups in one hall at the same hour (blocks may overlap).
- The real design (logo, photos, gentle animation) is step 9, later.

## 15. The calendar phone, clearer and in colour (Fouad's comments of 24 November; no database update)
- **Each activity or booking takes the colour of its area** (the colour set in the calendar settings, as on the laptop): a coloured
  bar and a light tint, so the text stays dark and readable. Outside the centre: grey; the whole centre: dark. The area colour was
  already in the pack: nothing new is sent, and still no prices or payments.
- **Small marks:** our own activities plain; an outside booking gets a tag "Booking · حجز", a stay "Stay · إقامة"; **to confirm** is
  dashed and striped with a "To confirm" tag; arrived / left have their tag; each line also names its area. A private one still
  shows only "Reserved · محجوز".
- **Week:** each day is its own block with a clear heading (the day, and how many things), **today highlighted** (dark heading, gold
  frame), past days a little paler, a closed period as a band, and an empty day says "Nothing planned — an empty day".
- **Today:** activities and bookings come first, then guests, then "To prepare"; bigger hours and names. **Spaces:** the same
  colours and bigger names.
- Tried in the side pane at 375 wide on a new empty test database: Today, Week (English), Spaces (Arabic, right to left).
  Not tried: French, a real phone, many colours of areas, very long group names.
- **Small fix:** on the calendar phone, "I forgot the code" now asks "Yes, forget this phone / Cancel" inside the page (the browser's own box is blocked in some views). No other `confirm` or `alert` is in that page.
- **Halls and rooms apart (calendar phone):** on Today, Week and Spaces there are two titled groups, **Halls · القاعات · Salles** and **Rooms · الغرف · Chambres** (title in the phone's language). Activities and bookings in halls go under Halls; stays under Rooms. Arriving / leaving / free tonight and the bedroom "To prepare" lines belong to Rooms; the hall "To prepare" lines to Halls. Area colours and marks kept. A space is a room when its kind has beds (as in "To prepare"), otherwise a hall; no pack change, no database update. Tried at 375 wide (Arabic: Spaces and Today).

## 16. The doors page (job J1, 24 November 2026; no database update — update 77 stays free)
- **Entering a centre now shows the doors page**: the centre's mark in its light, its name, a warm sentence, then large badges — **Accounts, Calendar,
  Inventory, HR** — each coming in one after the other (same style and movement as the first page), each with its own warm sentence and a small
  number where something waits (books to look at, problems and purchases for the inventory). A person with a single door (Reception, the store
  keeper) sees the same page with that one door.
- **Which doors show is decided by the ticks already there (no new right)**: Accounts = keeps a book, or looks at the books, reports, budget, donors, lists,
  exports or closes months; Calendar = "Sees the calendar"; Inventory = "Sees the inventory"; **HR = there is an HR database on this server that this person may
  enter** (their name and password also exist there, or the Coordinator's grants) — HR is one for all the centres and separated inside, the badge says so and
  shows the four marks. Someone with no door sees a gentle note. (`src/doors.ts`, tested in `tests/doors.test.ts`.)
- **Each door has its own menu** with a clear back button at the top, "→ MAGIS · الأبواب" (English: "← MAGIS · Doors", French "← MAGIS · Portes"; on a narrow screen the button
  stays in the top bar). Accounts: Home, Register, Cash, Reports, Budget, Grants, Lists, Export. Calendar: the calendar (its settings stay inside it).
  Inventory: the inventory (its settings stay inside it). Guide, Admin/Settings and the usual bottom buttons are in every menu. The HR badge opens the HR
  database the same way the list of databases does (no new sign-in).
- **The old calendar ("Calendar · الإقامة والتقويم") and the old inventory pages leave the menu and the home page** (their data stays; the pages are no longer reachable).
  The menu names are simply "Calendar · التقويم" and "Inventory · الجرد". The "purchases to register" warning on the accounts home now leads to the new inventory.
- **Ready-made roles** (Roles and permissions → "＋ Permission profile" → "Start from a ready-made role"): Director, Accountant and calendar, Reception, Store keeper,
  Coordinator (workshops, academic). They only fill the name and the ticks; everything stays editable. The ticks are exactly the two baselines' tables
  (calendar 2.1 §3, inventory 1.1 §2): Reception = sees the calendar and its contacts, books outside groups, keeps organisations, welcomes guests, never prices;
  Coordinator = those plus our programme, prices and payments, and looks at the inventory without its values; Director = every calendar tick, looks at the inventory
  with values and at the books; Store keeper = the keeper's three inventory ticks; Accountant = the accounts as the Accountant profile has them, plus "Sees the calendar".
  Nothing is added to the databases (no update): the roles are made by the Superior when needed.
- **The warm sentences** (`src/ui/doorSentences.ts`; for Fouad's review: `DOORS-SENTENCES.md`, 49 sentences with their sources): from the MAGIS charter, the explanation of the
  centres' logos (the Arabic text), the concept note, three testimonies (never a name), the sentences already on the first page, and a few clearly marked ORIGINAL
  ones in the same spirit. One under the centre's name (its own logo or house sentence when it has one) and one per door chosen to suit it; drawn at random each time the page opens,
  never twice on the same page and not the one of the last visit. Arabic always, with the English or French under it. English or French that is a translation of another
  language's source is marked in the review file.
- Tried in the side pane (a copy of the test data on its own port, never the real data): the Coordinator (all four doors, the HR door opens the HR database), Reception (one door;
  the calendar opens; its menu and back button), the store keeper (one door), the accountant (Accounts and Calendar; the accounts menu), the roles page with the five
  ready-made roles made from it; English, French and Arabic; a narrow screen. Not tried: a Director sign-in; several HR databases at once (a small list opens); a real phone.
- Remark: the accountant of the real databases already has the inventory keeper's ticks (update 55), so there he sees the Inventory door too; the ready-made "Accountant and
  calendar" role does not. Two tests of `tests/calphone.test.ts` fail only when the day five days ahead is a Sunday (the Sunday warning) — not touched here.

- **The way back, on every page of a door (Fouad's test of 24 November: "there is no way to go back when we enter the door")**: a bar at the top of every page of Accounts,
  Calendar and Inventory with the button "→ MAGIS · الأبواب" (English "← MAGIS · Doors", French "← MAGIS · Portes") and the door's name; the centre's mark and name in the
  top bar of the menu also lead to the doors page; the browser's Back and Forward buttons now walk the pages of the program (down to the doors page, no dead end); after a
  reload of the browser the person comes back to the page they were on. The HR door: the HR application has the same bar and a button at the top of its menu that return to **this
  centre's** doors page (no new sign-in). Tried in the side pane (narrow window; the wide layout uses the same bar): each door, a page inside (Register, Calendar settings),
  Back / Forward, reload, HR and back. Not tried: the Inventory item page itself (the bar is above every inventory page), a wide window by eye.

## Not in the installer (tools only)
- `scripts/alard-build.ts`: makes the ready Al-Ard database, following the main list "Al Ard".
- `scripts/test-data.ts` (J4): fills a COPY of a centre database with SAMPLE data of the new Calendar and Inventory, using the program's own
  operations (so H…/HR… numbers, history and rules are the program's): the missing spaces (hall, classroom, 3 bedrooms, kitchen, store: what
  exists is kept), 5 organisations with persons, 7 weekly activities (one date cancelled, one moved), a whole-centre open day, an activity
  outside the centre, about 15 outside bookings (USD and SYP, services, the projector asked, holds with dates, one private, a stay of 3 nights
  with breakfast, a stay going on, payments, ONE cancellation with a part kept and money given back), 31 items (a group of 40 chairs that
  splits, a laptop with a holder, the projector shown in the calendar, 3 "to repair", 1 broken), one problem reported, a count of the classroom.
  Everything is marked ("Sample…" names, notes "SAMPLE <key>") and never made twice (a second run adds nothing). It refuses any path with
  `real-db`, and first copies the database to `dbs/<db>/backups/<time>_before-test-data.db`. The sample weeks start on the first Monday after
  today and after any space closed for repairs. Stop the server of that folder first. Test: `tests/test-data.test.ts`. Run:
  `node_modules/.bin/esbuild scripts/test-data.ts --bundle --platform=node --format=esm --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" --log-level=error --outfile=/tmp/test-data.mjs`
  then `node --no-warnings /tmp/test-data.mjs ../test-servers/next-test magis-homs`.

## 17. Guide and test checklists for the new Calendar and Inventory (calendar step 8, inventory step 5; 24 November 2026; no database update)
- The built-in Guide (accounts) has two new sections written for centre staff, Arabic, English, French: **Calendar · التقويم** and **Inventory · الجرد**
  (`src/guide/calendarInventory.ts`, 15 and 13 steps). Only what the screens do; "Receipt", "prepare". The two old sections are kept and renamed
  "(the older page)" because their pages left the menu: they can be removed or merged later (Fouad to decide).
- `CHECKLIST-CALENDAR.md` and `CHECKLIST-INVENTORY.md`: numbered tests for the side pane, with the points not yet tested marked.
- Test: `tests/guide-calendar-inventory.test.ts`. Not done (postponed by Fouad): reports by organisation, optional reminders.

## 18. Roles as data, several roles per person (roles step 1, 25 November 2026; database update 77)
- **The ready-made roles are now real roles in each centre database**: Administrator, Director, Accountant, Book holder, Reception,
  Coordinator (workshops), Store keeper (`src/roles.ts`). A role made by hand stays a **"Custom"** role and works as before.
  HR keeper and HR Sessions are NOT made yet (the HR parts wait for Fouad's HR reflection).
- **A person may hold several roles** (Admin → Users → ✎: the roles are chips, one or several). Their rights = all the ticks of all their roles
  together; each role only adds. The doors come from that (Reception + Store keeper → Calendar and Inventory). Under **"Advanced: exceptions on
  this person"** a tick can be added for one person only; the list shows it as "Exceptions: +1".
- **For each sensitive thing, the screen says which role brings it**: "Sees: prices — because of: Coordinator (workshops)" (prices, inventory values,
  salaries, donors and grants, the Respo book), in the Users list and in the person's window.
- **Limits checked by the server** (not only hidden): only the Administrator gives (or takes away) Administrator and Director, and only he changes,
  switches off, resets the password of, or "signs in as" the Administrator; the Respo book and private books (`register.private`) and grants/donors
  (`lists.donors`) are refused in any role but the Administrator's and in every exception, even when the Administrator asks; a Director gives the
  other ready-made roles, but a Custom role, an exception or a new tick in a role only within what he has himself; nobody gives himself a role;
  at least one active person keeps the role Administrator. The Director role has no donors and no Respo (it manages the users of the centre).
- **Nobody is locked out by update 77**: nothing is taken from anyone. The old Superior (the role that manages users) becomes the role
  **Administrator** with exactly its ticks (its name "الرئيس · Superior" becomes "المشرف · Administrator"); the built-in Accountant and Book holder
  become those ready-made roles with their own ticks; the four missing roles are added, given to nobody; HR, the communities and the country get
  nothing. Rehearsed on copies of the five test databases (demo, magis-homs, hr-sj, a community, syria): every person's rights equal before and
  after, a second run does nothing. Tests: `tests/roles.test.ts` (union, limits, nobody locked out, sign in as).
- A Custom role made before that still has donors or Respo keeps them for its people (nobody locked out), but cannot be given to anyone new;
  step 2 (Respo and Grants for the Administrator only) will look at these.
- Tried in the side pane on a copy (own port): Fouad gives Darine Book holder + Reception + Coordinator and one exception; Nagham made Director:
  her doors, her Users list (no buttons on the Administrator's line, Administrator and Director chips greyed), and as her the server refused:
  giving Director, Fouad's password, a donors exception, a tick she lacks; giving Reception worked. The roles page shows the seven roles.
- Not done here (later steps): the full Users window and "who gives what" (step 3), Respo/Grants hiding pass (step 2), the book with the user (step 5),
  the HR roles (paused).

## 19. Who gives what, and the Users window with several roles (roles step 3, 25 November 2026; no database update)
- **Who gives what, checked by the server** (`src/ops.ts`, the same rule in `src/roles.ts` `whyNotGive` for the screen): the
  **Administrator** gives every role, Director and Administrator included; the **Director** adds and switches off the people of his
  centre and gives the other ready-made roles (Accountant, Book holder, Reception, Coordinator, Store keeper), a Custom role only within
  what he has himself; the **Accountant** (when his role has "Adds book holders") adds **book holders only**: their name, their book,
  their password, switched off; never the Main book, never another role, never an exception.
- New limits: **nobody gives himself a role**, the Administrator included (a second Administrator does it); a Director never changes
  **another Director's** line (name, password, books, switched off): the Director is the Administrator's to look after; his own name
  and password stay his. A **private book** (the Respo book) is given to a person by the Administrator only. At least one active
  Administrator stays (as in step 1).
- **The Users window** (Admin → Users): one line per person: *Name (and the books kept) · Roles as chips · Doors · Exceptions (+n)*,
  with "Sees: prices — because of: Coordinator" under the roles. The Administrator's and the Directors' lines have no buttons for a
  Director. The people switched off are folded under "Switched off (n)".
- **Add / change a person**: name; the password given once (a new person must change it at the first sign-in; for a known person a
  button "Give a new password"); the roles as chips, several; the chips one may not give are greyed and **the reason is written under
  them** ("Administrator · Director: For the Administrator only"); one plain sentence for each chosen role; "because of" line; the
  doors this person will see; "Advanced: exceptions on this person" folded; the books kept.
- **The Roles page** (Admin → Roles, was "Roles and permissions"): the seven ready-made roles, one sentence each, how many people hold
  each, and **"Make a copy to adapt"**: the copy is a Custom role (a Director may copy a role he gives — the Accountant for example —
  and then only add ticks he has; the Respo book and the grants never go into a copy). The Custom roles below. Every tick of every role
  folded under "Advanced: all the ticks of every role" (the Administrator's and Director's columns cannot be ticked by a Director).
- **The Accountant's own small window** (Admin → Book holders): the book holders only, "+ Book holder", the book (not the Main book,
  not a private book), the password, switch off; his own password; and, if his role may reset passwords, the password of another
  person (folded).
- Tests: `tests/roles.test.ts` "who gives what" (the screen and the server agree for Administrator, Director, Accountant on every
  ready-made role; Director and another Director; the Accountant's limits; private book; "Make a copy to adapt"). 423 tests pass.
- Tried in the side pane on a copy (own port): as Fouad (Roula given Store keeper), as Nagham the Director (Hiba added as Reception +
  Accountant; Director/Administrator greyed with the reason; server refused giving Director, Fouad's password, a role to herself,
  copying the Director role; copying the Accountant worked), as Assem the Accountant (after Fouad ticked "Adds book holders" on the
  Accountant role: Karim added as book holder; the Respo book not offered).
- Note: on Homs today the Accountant role does **not** have "Adds book holders"; Fouad ticks it on the Roles page if he wants it.
- Not done here: the book made with the person (step 5), the Respo/Grants hiding pass (step 2, other session), HR roles (paused).

## 20. The door "Administration": people and roles (Fouad's decision, 25 November 2026; no database update)
- A **fifth door** on the doors page, **"Administration · الإدارة"** (a person with a small shield, the same look and warm
  sentences as the other doors), shown **only to whoever holds the role Administrator or Director** (`src/roles.ts`
  `peopleDoor`; a database not updated yet: whoever manages the users). Normal sign-in; nothing new to remember.
- Inside, its own menu and the "← MAGIS · Doors" bar: **People** (the Users window of §19, with the phones under it) and
  **Roles** (the ready-made roles, one sentence each). The screens live in `src/ui/People.tsx` (they can move again easily).
- **Roles: the ticks are the Administrator's.** Only he changes the ticks of a role, makes a Custom role ("Make a copy to
  adapt") or deletes one; they are under "Advanced (the Administrator)". The Director reads the list and gives the roles on
  People (the server refuses him the rest: `access.save`, `access.delete`). This replaces the Director's "copy within his
  ticks" of §19.
- **Accounts → Admin is now "Settings · الإعدادات"** (so that "الإدارة" means one thing): month closing, checks, controls,
  backups, appearance, audit log, sections, server. Users and Roles left it. The **Accountant keeps his small Book holders
  window there**; whoever has no Administration door keeps his own password there too.
- Guide: a new section "Administration: people and roles"; the Admin section is now "Settings"; the paths "Admin → …" read
  "Settings → …", and the phones "Administration → People → Phones". Five charter or concept-note sentences already in use
  also suit the new door (`DOORS-SENTENCES.md` regenerated). "Report a problem" unchanged.
- Tests: `tests/doors.test.ts` (the fifth door, last, from the roles), `tests/roles.test.ts` (ticks and copies for the
  Administrator only; who sees the door). 424 tests pass.
- Tried in the side pane on a copy: Fouad sees five doors, Administration → People and Roles with "Advanced"; Nagham
  (Director) has People and Roles, no "Advanced"; Assem (Accountant) has no Administration door and keeps Settings → Book holders.

## 21. Respo book and Grants for the Administrator only (roles step 2, 25 November 2026; no database update)
Fouad's decision: the Respo book (and every private book) and the grants/donors are the Administrator's alone. A Director sees the centre's own
money, the **project** and the amounts, **never the donor's name nor the grant steps**. The two ticks (`register.private`, `lists.donors`) were
already refused in every role but the Administrator's (step 1). This step goes through every place that sent or showed them, and makes **the
server cut what it sends** (not only the screen).
- **What the server no longer sends** to someone without `lists.donors` / `register.private` (tested through the real server, `tests/respo-admin-only.test.ts`):
  the donors, grants, grant parts and shares (as before); the **link to a grant** (`grant_id`) on every row; the Respo book's **opening money**
  (its name stays: the transfers it makes name it); the months closed for it; the **documents** of its rows (`doc.get` refused); the other leg of a
  transfer from it shows the amount, not why; in the **audit trail** every line about grants, donors and Province sends, and every line about a
  row of a private book; in **Province sends** the donor, the contract and the text written (date, amount, project stay); in the **lists file** for
  the holders the Respo book's opening money and what is written on its transfers; **backup compare** (same rules as the register).
- **Writing**: a person without the grants can neither link nor unlink a grant when saving a row (the row keeps the grant it had); only the
  Administrator makes a book private or public again (`book.setPrivate` needed only `users.manage`, so a Director could have opened the Respo book);
  a private book you do not see is not changed by Lists → Books (`book.save` refused); "All centres" on a server without a directory now needs the grants
  tick as well as the users tick (the Director has `users.manage`).
- **Screens**: Reports → *By project* (Grant, Received, Left columns) and *Funding* ("Reached the Respo", "With the Respo", grants / other in) only for
  the Administrator; Budget → *Projects* (Grant, the project's money, Difference) and the project page (grant share, received) only for the Administrator;
  the book lists (Register filter, Files, Quarters, Lists → Books, Excel Books and Holders sheets) show the books you may see (the Respo book is not
  listed for others). A Director sees the project, its budget lines and what it spent.
- **Old Custom roles** that still carry donors or the Respo book (kept by step 1 so nobody is locked out): Admin → Users shows the Administrator a
  short notice listing them (name, how many people, which of the two). Nothing is removed automatically; they cannot be given to anyone new.
  (`src/ui/OldRolesNotice.tsx`, shown on the People page above the users list.)
- **Tried** on a COPY of the test data (own port, password test123) as Administrator and as a new Director: the Director's data has 0 grants,
  0 donors, 0 `grant_id`, no Respo income rows (4 transfers only, no explanation), opening money 0, no donor/grant line in the audit trail, Reports and
  Budget screens without the grant columns; the Administrator sees everything as before and the notice lists the old role "Secretary (old)".
- **Not changed / for Fouad to know**: a full **copy** of the database (`backup.download`, tick "Takes a copy", asked a copy password) always holds
  everything, grants included: give that tick only to the Administrator. A private book's monthly expense totals ("Private expenses") stay visible as
  before. The phone app already sent only the books a person keeps. Writing in the Respo book by a custom role with `register.edit` but without
  `register.private` is not refused (nobody has that today; to decide with the roles screen, step 3).

## 22. The book made with the person, in one window (roles step 5, 25 November 2026; no database update — 78 stays free)
- **Add a person (Administration → People, and the Accountant's Book holders window)**: when the role **Book holder** is ticked (alone or with other roles),
  a line appears: **"keeps a cash book — the program makes their book with their name and links it to them"** (ticked for a new person). On Save the program
  makes the book **in the same step as the person** (both or neither): the book has the person's name (also as keeper), **not private**, in the **Main book's
  city and account**, no opening money, and is linked to the person. A new window then shows the **temporary password once** (and the book made).
  No separate "new book" step any more. Lists → Books stays for renaming or switching a book off.
- **The password**: a new person's password may be **left empty**: the program makes 6 digits and shows them once (still typed by the giver if he wants;
  then it is not shown again). The person changes it at the first sign-in, as before. (`user.save` now answers `{ id, book, password }`.)
- **A Director or the Administrator** gives Book holder + other roles in one step (e.g. Book holder + Reception + Store keeper): works, same limits as
  before (only the Administrator gives Director/Administrator).
- **Giving the Book holder role later** to a person who has no book: in the person window the same line is offered (not ticked); ticked, the book is made.
  A person who already keeps a book is not offered one. The name of an existing book is refused with a clear sentence (nothing is made).
- **Switching a person off switches their book off**, never deletes it (its rows, its history stay; the link stays too). Only the books **nobody else
  active keeps**; **never the Main book, never a private book (the Respo book), never a community's book**; the envelopes inside it go with it. The question
  says which book(s) go off; a short message says it after. Same in the Accountant's window. Books already linked to existing people: nothing changes
  until that person is switched off.
- **The Accountant's window stays limited**: Book holder role only, no other role, no exception, never the Main book, never a private book, never a
  person who is not a book holder (the server refuses it; the book made is his own, not private).
- **Code**: `src/roles.ts` (`KEEPS_BOOK`, `keepsBook`, `booksSwitchedOffWith`, same rule as the server for the screen), `src/ops.ts` (`saveUser` `makeBook`,
  `booksOffWith`, `user.deactivate`), `src/ui/People.tsx` (`KeepsBookLine`, `CreatedModal`, both modals).
- **Tests**: `tests/book-with-person.test.ts` (7: book made with the user; typed password not given back; no tick = no book; roles that keep no book refused; same
  name refused with nothing made; Director gives several roles with the book; book later for an existing person; switched off with the person, shared book
  stays, Main and Respo stay; Accountant limits; existing books untouched). All 440 tests pass.
- **Tried** in the side pane on a COPY (own port, password test123): as Fouad (Administrator) a new person with Book holder + Reception → the line, the
  book "Karim Test", the temporary password shown once, "Keeps: Karim Test" in the list; switched off → the question names the book, the book goes off;
  an existing Book holder without a book (Karim): the offer, ticked, the book made, password "not changed". As Assem (Accountant): "New book holder"
  → book made and password shown; switched off with the book.
- **Not done / for later**: the Guide does not mention it yet (step 9). The old button "Create accounts for all book keepers" (accounts for books made
  before) stays as it is.

## 23. "Test as…" at the top of Administration (26 November 2026; no database update)
- Fouad tests the roles and wanted to open the program as any person quickly. At the top of every page of the Administration door
  (People, Roles) there is now a small control **"Test as… · الدخول باسم…"**: a list of the people of this centre (name and role names),
  **See only / See and act** (default "See only", remembered while the program is open) and a **Go** button. It uses the same function
  as the 👁 button (`serverSignAs`, `/api/as`): same server rules, same history line ("Fouad as X"), the band at the top with the way back.
  New in the screen only: after signing in the person lands on **their own doors page**, not on the Administration page it was chosen from.
- **Who is in the list**: active people, never oneself, and unless one is the Administrator never the Administrator and Director lines
  (the same as the 👁 buttons on People; the server refuses them too). Shown only to whoever may use "sign in as" (`maySignAs`), nothing
  when signed in as someone else. The 👁 buttons on the person lines are unchanged.
- Code: `testAsChoices` in `src/roles.ts`, `TestAs` in `src/ui/SignAs.tsx`, placed in `src/ui/Shell.tsx`, a few lines in `src/styles.css`.
  Test: `tests/test-as.test.ts` (3). 443 tests pass.
- Tried in the side pane on a COPY (own port, password test123): as Fouad (Administrator) the list shows all five other people, "Assem, See only"
  → Assem's doors page with the band and the way back; as Nagham (Director, made Director in the copy) the list has no Fouad, no other
  Director and not herself; "Julian, See and act" → Julian's doors page, band "written Nagham as Julian", log line "Nagham signed in as Julian (see and act)".

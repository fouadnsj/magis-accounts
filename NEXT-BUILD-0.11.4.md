# What is new for the next build (0.11.4) — list made 21 November 2026

Everything below is committed on `main` after the tag `v0.11.3`. Nothing here is in an installer yet.
Build only when Fouad says "build".

## 1. Done, in the code

### The phone
- **Several databases on one phone** (the centre and the community, for example): menu ☰ → *Link another database*, the same
  phone code, buttons at the top to switch, the number waiting on each button, *Unlink this database*. A phone linked before
  keeps its rows (it takes its database's name the first time it is opened).

### The welcome page
- The **badges at the top are the doors** (no scrolling), each with its own animation; the three big cards are gone.
- The **Jesuit sun at the top is the Jesuits' badge**: no name (it is in the logo), **لمجد الله الأعظم** and *Ad Majorem Dei Gloriam* always shown, then *Sign in*.
- Each house's **sentence is back** (shown when touched; always on a phone).
- The **"Welcome" block in the middle is gone.**
- The charter's Arabic starts with **نحلم** (without «فإنّنا»).
- The first page knows that communities exist, without naming them (so the Jesuit door always shows).

### Al-Ard, the fourth house
- A centre like Jaramana: **orange**, its **spiral mark** (redrawn from the SVG: the circle is whole), sentence
  **«الأرض: حيث يمكننا المضي للعمق»**; on the welcome page, the sign-in, HR, grants, the phone, creating a database.

### The Coordinator
- The first page is **Databases**, in **three doors**: MAGIS centres, HR, Jesuit communities. *What is waiting* is the second tab.
- A Coordinator who is also a **Jesuit of a community enters it as himself** (his own book, his hats), not as the Administrator account.

### The communities
- The **categories of "I received" are grouped under the chart's sections** (Ordinary income, Extraordinary income,
  *Assistance from the Province funds*).
- **No communities' password** any more on the server (done in 0.11.3); the **Settings card is now removed too**.
  The desktop app that opens a file keeps its own local password.

### For all windows
- **Confirmation and prompt windows (and the toast) now appear above the community's entry sheet.** Before, the
  "Delete this entry?" window was hidden behind it.

## 2. To check on your side before or after the build
- **Phone with several databases** on a real Android (camera, home-screen icon, weak connection).
- The **Windows server uninstall** (built by GitHub in 0.11.3, never run): Start menu → MAGIS → *Uninstall MAGIS Server*, and
  Settings → Apps; it must ask whether to keep the data.
- The **inventory** (0.11.3) with a real list: Jaramana's Snipe-IT export, the phone walk-through, the printed labels.
- Al-Ard's sentence: the **English and French** are mine ("Al-Ard: where we can go deep", "là où nous pouvons aller en profondeur").
- **The community's chart** in the real database: are the lines 73100–73300 (Assistance from the Province funds) there and active?
- Checklist: `TEST-2026-11-14.md`, section 17 (several databases on one phone).

## 3. Questions waiting for Fouad
- (Answered 21 November) Money from the Province reaches a community by **"I received"**, as a **donation** or an **opening
  balance**: no change. The account at the Province treasury is for the regional/country level, not used yet.
- (Answered 21 November) The Jesuit badge shows **لمجد الله الأعظم** and *Ad Majorem Dei Gloriam* **always**, and no name
  ("Jesuits · اليسوعيون": it is already in the logo). Done.
- The Coordinator should enter the Al-Ard database from the "MAGIS centres" door: confirm it is the right place for it.

## 4. Ideas kept for later (not done)
- January 2027: how to treat **Canzali** (own budget, a separate database, or the same database with a private book and a
  Transfer from the Respo). Nothing changes before.
- A simple **"send" between two databases** (like the Province's send) if a separate Canzali database is chosen.
- The inventory for the Jesuit communities and the Homs building.

## 5. For the build itself
- Version 0.11.4 in the 5 files (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
  `server/server.ts`), tag `v0.11.4`, push, Mac dmg, GitHub builds the Windows installers, then a new `installers-0.11.4` with
  its `INSTALL-README.md` and `desinstaller-mac.command`.
- The upgrade of the **real server (0.7.4)** to the new version: rehearse on a **copy** first; the upgrade makes a
  `…_before-update-…` copy by itself.

---
## Built 21 November 2026 (v0.11.4) — and what is NOT in it
- Built and tagged `v0.11.4`; Mac dmg and Windows exes are in `installers-0.11.4`.
- **Not in it:** Al-Ard's farm list of headings and lines (Fouad confirmed it on 21 Nov, after the tag; he can change it later
  in the database). Income: farm sales (table olives, olive oil, quince, grapes, apricots, almonds) and camps. Expenses: fixed
  salaries, machine maintenance, fuel, alternative energy, daily labour, seasonal labour (pruning), fertilizers, pesticides.
  → put in the next build (0.11.5 or with 0.12.0).
- 0.12.0 (his notes to come): accommodation + calendar sections on/off per centre, booking statuses, services list, suggested payments, offline phone calendar.

## 0.12.0 — Fouad's decisions (21 Nov 2026)
- **Prices of accommodation are seen only by the Superior, the Accountant and whoever holds the calendar ("keeps the calendar" tick).** The reception person sees bookings, rooms, dates, people, status — never the agreed amounts or payments. (Hide in the server answer too, not only on screen, and on the phone copy.)
- **Phone offline:** a booking made offline is ALWAYS "to confirm" until the phone reaches the server. On sync, a window lists each offline booking with its status: no conflict → "Confirm"; room/date already taken → change dates or rooms; plus a reminder to call the person who asked.
- Per-section on/off for the centre: Inventory, Calendar/accommodation (events too). Booking statuses: to confirm → confirmed → arrived → left → cancelled (from the website calendar).
- Price per person per night (usual) or fixed price per group; services list editable in Settings (breaks, logistics, heating…).
- Payments of a booking = suggestions the accountant turns into income entries (like the inventory "To register"); same idea later for salaries (needs a send from HR to the centre).

## 0.12.0 — built on `main` 22 November 2026 (not in any installer; build only when Fouad says "build")
- **Accommodation and calendar** (migration 58): buildings and rooms (each room is also an inventory place), bookings (stay / event in a hall),
  statuses to confirm → confirmed → arrived → left / cancelled, beds shared in a room, "rooms by day" calendar, services list (editable),
  price per person per night or fixed for the group, payments as suggestions of entries (receipt number H2027-0001 links them to the entry).
- **Ticks:** `hosting.view`, `hosting.book`, `hosting.keep`. The Superior and the Accountant keep it. Prices and payments are removed on the SERVER for the others (and never go to the phone).
- **Sections on/off per centre:** Admin → Sections (hosting off by default; inventory on by default). The menu follows.
- **Phone:** the calendar offline; a booking made offline is always "to confirm"; after the connection a window per booking (confirm if free, change dates or rooms if taken, call the person); the same window on the computer.
- **Al-Ard farm list:** Admin → Sections → *Add the farm's list* (3 headings, 15 lines; not in the migration, so each centre decides).
- Tests: `tests/hosting.test.ts` (17). Checklist: `TEST-2026-11-14.md`, section 18. Guide page "Accommodation and calendar".
- **Not done (kept for later):** salaries as suggestions (needs a send from the HR database to the centre); a public request page; the calendar for the Coordinator; Excel export of bookings.
- **Added 22 Nov (migration 59):** weekly repeating EVENTS (weekdays between two dates, with hours; never for a stay; two events in a hall only clash if their hours cross), month and year views, a colour per building (palette or chosen; also on the phone), a currency per service line and a payment window with currency. Tests: 23 in `tests/hosting.test.ts`.
- **Added 22 Nov:** drag over days/rooms to start a booking; type filter (accommodation / events); clearer save buttons; groups and people-in-charge remembered from the bookings (no new table: same name = same group, any case) with completion and auto-filled contact (desktop and phone); a **Reports tab** with Excel (`src/io/hostFile.ts`, `report()` in `src/hosting/host.ts`). Merging two spellings of one group is not possible (the name is the key): fix the spelling in the bookings.
- **Added 22 Nov:** the Reports tab shows the busiest months (bars, choice of measure), the days of any month (heat grid), the busiest days and the weekday pattern; Excel gets *Busiest* and *By day* sheets with colour scales. (`report().days`, `.weekdays` in `src/hosting/host.ts`; `BusyView` in `src/ui/Hosting.tsx`.)
- **Added 22 Nov:** the phone calendar has Day (opens first), Week and Month views (`src/phone/Calendar.tsx`).

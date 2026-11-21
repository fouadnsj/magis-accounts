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
- The **Jesuit sun at the top is the Jesuits' badge**, with *Ad Majorem Dei Gloriam* and, on touch, لمجد الله الأعظم.
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
- **Money from the Province to a community:** "I received" (73100–73300), or a movement in the **account at the Province treasury**
  (Promised → On the way → Received)? Which does he use?
- The Arabic **لمجد الله الأعظم** under the Jesuit badge (today only on touch/hover; the Latin is always shown).
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

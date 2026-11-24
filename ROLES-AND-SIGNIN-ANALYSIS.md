# Sign-in and roles: how it works today, and a simpler way

Analysis only, 24 November 2026. Nothing was changed in the program, in the databases or in the test servers.
Written for Fouad. Where I could not find something, I say "not found". I did not open the real databases (`real-db/`),
only the code, the plans, and the test copy (`next-test`, read-only).

---

## 1. What exists today

### 1.1 Who can enter where

| Door in | What the person types | What happens | Where it lives |
|---|---|---|---|
| **First page, "directory" person** | name + password | One person, one password, and a list of databases "given" to that person (`directory.json` on each server). The person enters each database as one chosen user of that database (or, for the directory administrator, as its Superior). | The server's own folder. **Each server has its own directory.** |
| **First page, a house** (Jaramana / Aleppo / Homs) | house + name + password | The server looks, in every database of that house **and in the HR database**, for a user with that name and that password. It opens a "ring": the person moves between the databases found without signing in again. | Users inside each database. |
| **Jesuits' door** | name + password | Same, over the community and country databases. A person never signs in as an office; offices are hats. | Community databases. |
| **Old per-database sign-in** (`/api/profiles`, name list) | pick a name + password | Refused when the directory is "enforced" (except on the server computer). | Each database. |
| **Sign in as** | one click on a user | Only for someone with the tick "Users and permission profiles". Two ways: *see only*, or *see and act* (the history says "X as Y"). The way back is always open. | Inside the database. |

### 1.2 Who a "user" is inside one database

- One table of users (`profile`) per database, each with a **password**, one **permission profile** (`access_profile` = a named set of ticks), and the **books** he keeps.
- Test copy, Homs: Fouad = Superior; Assem = Accountant; Roula, Nagham, Darine (and Canzali, switched off) = Book holder.
- Three profiles are built in (Superior, Accountant, Book holder). Anyone with the tick `users.manage` can make more, and since the doors job (J1) can **start a new profile from a ready-made role**: Director, Accountant and calendar, Reception, Store keeper, Coordinator (`src/doors.ts`). The ticks stay editable.
- Who can create users: `users.manage` (all users, all profiles); `users.holders` (book holders only); `users.passwords` (reset passwords).
- The **doors** (Accounts, Calendar, Inventory, HR) are not stored anywhere. They are **worked out from the ticks** (`doorsOf`). The HR door shows when the person has a place in an HR database of the server (through the sign-in ring or the directory grants).

### 1.3 The HR database

- A separate database (kind `hr`), with its **own users, passwords and profiles**: HR keeper, Reader, HR keeper of a centre, Superior, MAGIS manager (test copy `hr-sj`: 5 profiles, only Fouad as user).
- Each HR user has **`hr_centres`** = the centres he sees (empty = all). The server enforces it on every action (`src/hr/scope.ts`): what is outside the centres is never sent.
- So a Director of Homs who must see HR today needs **a second account** (same name, same password) in the HR database, with `hr_centres = Homs`. This is the "two or three accounts" Fouad noticed.
- 15 HR ticks (`hr.*`), plus admin ticks used there.

### 1.4 Coordinator and Administrator

- The **Coordinator** is the directory's *administrator* (`admin: true`): he sees every database of that server, enters each one as its Superior, manages the directory, the main budget lists, "All centres" reports and the Province money. He "sees and manages but never changes a centre's records" (decision 7 Nov 2026). It is **per server**: there is no network-wide Coordinator.
- The directory administrator is made once, on the server computer itself.

### 1.5 Two protections you named

**The "Respo" book.** In the Accounts, "Respo" is a **private book**: a book of the Superior where grants arrive in hand and where the Province's money arrives (`grantsBook()` in `src/ops.ts`; `grants_book_id` in the database). It is outside the centre's reports. In the test copy it is book 6 "Respo", kept by Fouad.
Protection today: a private book is seen only by its keeper and by whoever has the tick **"Sees the private books"** (`register.private`). Other people see only the transfers it makes, without explanation. Only the Superior profile has that tick (migration 1788 gave it to every profile with both `users.manage` and `register.view`). The ready-made **Director has no** `register.private`.

**Grants, Donors, Coverage.** One tick, **`lists.donors`** ("Donors and grants (confidential)"). It opens the *Grants* page and the donors list, saving grants and their steps, "Coverage", budget lines' fund ("Not funded"), Checks before closing. The Superior profile has it; Accountant and Book holder do not. The ready-made **Director has** `lists.donors` (so he sees donors and grants), which is **not what you now want**.
Also: *Admin → Main list* and "All centres" are for the directory administrator only; HR "scale" and "hourly cost" have their own ticks.

### 1.6 Weak points of today (in plain words)

1. A person may need **three accounts**: the centre (Accounts), the HR database, and maybe the directory. Three passwords to keep in step.
2. To give someone a role you must understand ~70 ticks. The ready-made roles help but are only a **starting point when creating a profile**, not something chosen on the person.
3. **Doors follow ticks** by guess work; there is no single place that says "this person is a Director".
4. The **Superior** of a centre is both the boss and the keeper of Respo and Grants. A Director is not the same thing, but today there is no clean "Director" without donors.
5. HR needs a second system of users with its own roles.
6. No network-wide view: each server stands alone.

---

## 2. Respo and Grants kept for the Administrator only

**What to change (idea, not built):**
- The two things sit behind two ticks: `register.private` (Respo book and other private books) and `lists.donors` (Grants, donors, coverage, funds).
- Make them **Administrator-only ticks**: they exist only in the role Administrator. No other ready-made role may carry them, and the "Advanced" ticks screen hides them (or shows them greyed "Administrator only") for every other role.
- Respo book is **private to the Administrator**, even for the centre's Director. The Director's book list simply does not show it.
- Inside the Administrator role keep **`lists.donors`** and **`register.private`**. Keep `users.manage` for both Administrator and Director (see 4).

**What a Director sees instead:**
- The centre's **own income and expenses** (as now, the Respo book is already outside the reports).
- For money that comes from the Province or from grants: **one line per transfer**, as today ("a private book's transfer: the other side sees the amount, not its explanation"), and **budget lines with their remaining amount** (`budget.view`).
- The **project** name on a line (since "Project" is the word you prefer), but **not the donor name nor the grant steps**.
- Not found yet: the exact list of screens where the donor name still shows (Reports "By project", Files, Explore). A short check pass is part of build step 3 below.

---

## 3. The Administrator with three servers

Facts today: three servers (Jaramana, Aleppo, Homs), each with its **own directory, users, HR database**. Nothing links them live. Files can travel between servers (main list, requests, copies). **One login cannot see HR of three centres at once, across servers: not possible today** (not found in the code; the "All centres" report and the Coordinator's views read only the databases of the server they run on).

| | (a) Same person, an account on each server | (b) A central server later | (c) Other: HR of each centre on the Administrator's own server |
|---|---|---|---|
| **Idea** | Fouad has the role "Administrator" on each of the 3 servers, same name. Maybe a second administrator person on each. | One main server holds the HR and the Administrator's accounts; centres connect to it. | The three HR databases are copied (by file) to one place for the Administrator to read. |
| **Can do today** | Yes: sign in to each server, see that centre's HR and Respo/Grants, give roles to that Director. Small work: create the account by hand once per server (the first-page directory can hold the same name, but each directory is separate). | Nothing built. The idea note `IDEA-WEB-APP-AND-CENTRAL-SERVER-2026-11-22.md` exists. | Partly: "From a database file…" imports an HR database, with its users, into a server. It is a **copy** at one moment, not live. |
| **Cannot do today** | See the three HR together in one screen. Passwords are not shared (three passwords, or the same one typed three times). | Everything. Also needs the internet link in Syria to be reliable. | Be up to date; write back to the centres. |
| **Distributing roles to Directors** | On each server, the Administrator makes the Director with the role Director. | Done once, centrally. | Not applicable. |
| **Risk** | Low. Works with what exists. "All the HR" = three visits. | High (new work, connection, security). | Medium (copies get old; two places to correct). |

**My recommendation:** (a) now. One person (you) with the **same role Administrator on each of the three servers**, same name. Add a clear screen **"Administrator" → one list of the HR of that server's centre(s)**; across the three servers it is three visits, and later (b) can be built on top without losing anything. Say it plainly to the Directors: *"your HR is seen by you and by the Administrator, on your own server."*

Decision for Fouad: is "all HR = sign in to each server" acceptable for the next months? Is there a second administrator (another person) who needs an account on every server?

---

## 4. The simpler model proposed

### 4.1 Principle

**One person. One name. One password. One ready-made role, per centre server.** The role is a named bundle of the existing ticks. Doors come from the role. The ticks stay editable under **"Advanced"** (not removed). HR is one extra choice on the person ("HR keeper of: Homs"), not a second account.

### 4.2 The roles

| Role | Accounts (books, reports, budget) | Calendar | Inventory | HR (own centre) | Respo + Grants | Creates / removes users |
|---|---|---|---|---|---|---|
| **Administrator** (network) | everything | all | all | all centres on this server, can give HR keeper rights; sees salaries | **Yes, only him** | Creates Directors; removes them; may "sign in as" |
| **Director** (centre) | looks at books, reports, budget (no write in books); no donor/grant names | whole calendar | looks, with values | HR of his centre: choice "HR keeper" ticked or not | **No** | Adds and removes users of **his centre**; cannot make a Director or Administrator |
| **Accountant** | writes Main book, closes months | looks | no (or if the centre ticks "keeps the inventory") | no (unless "HR keeper" is ticked on him) | No | Book holders only |
| **Reception** | none | books outside groups, guests, contacts; **no prices** | no | no | No | No |
| **Store keeper** | none | none | keeps it, sees values | no | No | No |
| **Coordinator (workshops, academic)** | none | programme, prices, payments | looks, no values | no | No | No |
| **Book holder** (as today) | own book | none | none | no | No | No |

Rules:
- **Who can create whom:** Administrator makes Directors; the Director makes everyone else of his centre (not Director, not Administrator); the Accountant adds Book holders (as `users.holders` today).
- **HR by centre:** the server enforces it, as today (`hr_centres`). HR keeper is a **choice on the person** (Director, Accountant or anyone, e.g. "Rima: Reception + HR keeper of Homs"). The Administrator sees HR of all centres on his server and **distributes** the HR keeper right to Directors (Directors can pass it on to others of their own centre).
- **One account per person:** the HR database account is created and kept in step **by the program**, behind the scenes, from the choice on the person: same name, same password (the password lives once). The HR database stays a separate database (privacy of salaries), but the user is not asked to keep two accounts.
- **Each centre's server is its own boss:** nothing in the model asks one server to know the other.

### 4.3 How today's users are mapped without losing access (to be described, rehearsed, never done on real data first)

For each existing user, on a **copy** of each real database first:
1. Read his profile ticks. If they match a ready-made role exactly, give that role.
2. If they match only partly: give the **nearest role** and keep the extra ticks as **"Advanced" differences**, so nothing is lost; the Director reviews the short list.
3. Superior today = **Administrator** (on Homs: Fouad) or **Director** (a Superior who is only the centre's boss) — Fouad decides person by person.
4. Book holders stay Book holders. Their books are untouched.
5. Users who exist in both the centre and the HR database with the same name: merge them (the HR choice appears on the person; the HR account stays for the HR database, linked).
6. A user whose name differs between centre and HR: left as is, shown in a "To check" list.
7. Rehearse on copies of the six real databases and compare "who can do what" **before and after**, as the plan already does for other updates (J5). No date, no installer until Fouad says "build".

### 4.4 What changes on the screens

- **Admin → Users:** a user line becomes *Name · Role · Centre HR (yes/no) · Books*. Add-user window: name, **one role** dropdown, "HR keeper of…" tick, books (if holder). Password given once.
- **Roles page** (today "Roles and permissions"): lists the ready-made roles with a plain sentence each (already written in `doors.ts`), a "Make a copy to adapt" button; the full ticks live under **"Advanced"** per role.
- **First page and doors page:** unchanged in look; the door badges are read from the role.
- **Sign in as:** kept (see only / see and act); only Administrator and Director use it, and only on their own centre.
- **Admin → HR:** the second user list (Users & centres) becomes read-only information ("managed from the person"), except for the Administrator.

### 4.5 Build steps (rough size, parallel or not)

| # | Step | Size | Parallel? |
|---|---|---|---|
| 1 | **Roles as data:** one stored role per user (new column, new migration, the ready-made roles as real roles, doors from the role; old tick sets still work as "Custom") | Medium (1 session, Opus) | First; others wait |
| 2 | **Administrator-only Respo + Grants** (ticks only in the Administrator role, hidden from Advanced, Director screen checked for donor names) | Small–medium | After 1 |
| 3 | **Who can create whom** (Administrator → Director → others, in `users.*` operations and the Users screen) | Medium | After 1; with 2 |
| 4 | **HR choice on the person** (one account behind the scenes, same password, centre = his centre; ring sign-in keeps working) | Medium–large (risky: two databases) | After 1; independent of 2–3 |
| 5 | **Users screen and Roles page redesign** (one role, Advanced) | Medium | With 3 |
| 6 | **Mapping of existing users + rehearsal on copies, before/after report** | Medium | After 1, 3, 4 |
| 7 | **Guide and French/Arabic texts, test list** | Small | Last |

Order that works: 1 → (2, 3, 4 in parallel, three sessions on different files) → 5 → 6 → 7. Steps 2, 3, 4 touch different areas, but all touch `ops.ts` / `server.ts`; run at most two writers at the same time or commit by path.

---

## 5. Risks

1. **Locking someone out** at the update (an old profile that no role fits). Mitigation: "Custom" keeps the old ticks; before/after report on copies.
2. **Director loses things he uses today** (donor names in reports). Mitigation: a check pass on every screen that shows donors.
3. **HR privacy:** merging accounts must not give a Director the HR of another centre; the server rule `hr_centres` stays and is tested.
4. **Passwords out of step** between the centre and HR (two places). Mitigation: HR password follows the centre password, once.
5. **The Administrator is a single person** (Fouad) on three servers: if he is away nobody can give roles. A second Administrator should exist on each server.
6. **No cross-server view** remains until a central server exists; this is accepted for now.
7. **Real data:** the first update on real databases must be rehearsed on copies (`REHEARSAL-ON-REAL-DATA.md` exists in `test-servers/`). I did not open the real databases, so how many real users do not match a ready-made role is **not found / not known**.

---

## 6. Questions for Fouad (plain words)

1. **Is "the Administrator = Fouad, with the same role on each of the three servers" right?** Do you want a second person who can do the same on each server, in case you are away? *I recommend yes: one more person per server.*
2. **Should the Director be able to give the HR right to someone of his own centre?** (For example to his secretary.) *I recommend yes, only for his centre; you see it and can remove it.*
3. **Should the Administrator see the salaries of all the HR in each centre, or only the list of people?** *I recommend: everything, because you distribute the roles and approve the payroll.*
4. **The Director: does he see the donor's name and the grant steps?** You said Grants and Respo only for the Administrator. *I recommend: the Director sees the project and the amounts, but never the donor's name.*
5. **A Superior who is also the Director of a centre today:** do you keep the word *Superior* as another name for the Director, or drop it? *I recommend Director on screen, with "Superior" in small letters beside it for the first months.*
6. **Is it fine that the three HR are seen in three visits** (one per server) until a central server exists? *I recommend yes.*
7. **Book holders and Accountant:** they stay as today, an Accountant creates Book holders only. *I recommend keeping it.*

Nothing is built. When you say yes to these answers, the first job is step 1 of section 4.5.

---

## 7. Fouad's answers (24 November 2026)

1. Administrator = Fouad on each of the three servers, **and a second person** per server in case he is away. (As suggested.)
2. A Director may give the HR right to someone of his own centre. (As suggested.)
3. The Administrator sees everything of HR, salaries included. (As suggested.)
4. A Director sees the project and the amounts, **never the donor's name** nor the grant steps. (As suggested.)
5. The word on screen is **Director**, directly (no "Superior" beside it).
6. **The Administrator must see the three HR databases.** Work as soon as possible on a way for each server to share **the last copy** of its HR, so the Administrator has all three. (To design: see 8.)
7. Accountant and Book holders: **needs reflection**. Today you must create a book AND a user; a simpler way would be welcome. (To design: see 8.)
8. Fouad's proposal: **HR and Inventory stay roles** (HR keeper, Store keeper), and the Administrator and the Director can give **several roles to one person** (e.g. Accountant + HR keeper; Reception + Store keeper).

## 8. Next design points (manager's notes, to confirm with Fouad)

- **Several roles per person** (agreed in principle): a person's rights = all the ticks of all their roles together; doors come from that. Limits: only the Administrator gives Administrator or Director; the Respo book and Grants exist only in the Administrator role; an HR keeper role is always "of a centre". The ticks stay under "Advanced" for rare exceptions.
- **Book and user in one step:** when a person gets the role Book holder (or "keeps a book"), the program makes their book with their name; one window, no separate "new book".
- **The three HR for the Administrator:** HR data (salaries) is private and must **never** go through a cloud or a shared folder (Fouad's rule: real data stays off shared folders and clouds). Two stages proposed: (A) fast: each server makes a **locked copy file** of its HR (with a password), carried to the Administrator's server and opened **read-only** there, showing the date of the copy; (B) later: the servers send that copy to each other directly and securely over the network, if they can reach each other. Question for Fouad: can the three servers reach each other over the internet today?

---

## 9. Final design before building (25 November 2026, analysis only)

### 9.1 Several roles per person

**How a union behaves.** A role is a named bundle of ticks. A person's rights = **all the ticks of all their roles put together** (a tick present in any role is on). Doors come from that union, as now (`doorsOf`). Nothing is taken away by adding a role: that is simple and easy to explain ("each role only adds").

**The one thing a union can break is a "never".** A "no prices" role must stay safe when joined with another:
- "Reception never sees prices" is **not a ban**, it is only the *absence* of the tick `cal.prices` (and `cal.money`). Reception + Store keeper = still no prices, because neither role has them. Reception + Coordinator (workshops) **does** see prices, because Coordinator has `cal.prices`. This is correct: that person really is a coordinator too. The Roles screen says it in one line next to the person: "Sees prices because of: Coordinator".
- So the rule for the screen is: **show, for every sensitive thing (prices, salaries, donors, Respo), which role brings it.** No hidden bans, no surprise.
- Things that must never be reached by a union stay *only* in the Administrator role (Respo, Grants, donors) and are refused for anyone else by the server, even if an "Advanced" tick is added by hand (see limits).

**Limits (checked by the server, not only hidden on screen):**
1. Only the **Administrator** gives the roles Administrator and Director.
2. **Respo book and Grants/Donors** (`register.private`, `lists.donors`) exist only in the Administrator role. A Director cannot add them under "Advanced".
3. **HR roles are always "of a centre".** The person carries the list of centres (today's `hr_centres`). A Director gives an HR role only **for his own centre**; the Administrator for any centre of that server.
4. A Director cannot give a person more than the Director himself has (no climbing).
5. "Advanced" ticks = exceptions on **one person**, shown in a list "Exceptions: +2" so they are not forgotten; the Administrator sees all exceptions on the server.

**Final role table (a person has one or several):**

| Role | Accounts | Calendar | Inventory | HR (of a centre) | Respo + Grants | Who gives it |
|---|---|---|---|---|---|---|
| **Administrator** | everything | all | all | all centres of the server, salaries | **only him** | Administrator |
| **Director** | looks at books, reports, budget; no write; no donor name | all | looks, values | none by itself; may give HR roles for his centre | no | Administrator |
| **Accountant** | writes Main, closes months, adds book holders | looks | — | — | no | Director |
| **Book holder** | own book | — | — | — | no | Director, Accountant |
| **Reception** | — | contacts, outside groups, guests; no prices | — | — | no | Director |
| **Coordinator (workshops)** | — | programme, prices, payments | looks, no values | **"Sessions" section only** (9.2) | no | Director |
| **Store keeper** | — | — | keeps it, values | — | no | Director |
| **HR keeper (of a centre)** | — | — | — | the whole HR of that centre; with or without salaries (two kinds, as today's "HR keeper" / "Reader") | no | Administrator; Director for his centre |
| **HR Sessions (of a centre)** (new, narrow) | — | — | — | the **Sessions / attendance** page only | no | Director for his centre |

Inventory and HR "stay roles" as Fouad asked: Store keeper and HR keeper are roles of their own and can be combined (Accountant + HR keeper; Reception + Store keeper).

### 9.2 Workshops and attendance (Coordinator takes the attendance of the animators)

**What exists today:**
- HR: **tutors' sessions** register (migration 38). Page `Sessions` (`src/hr/ui/Sessions.tsx`), operations `hr.sessions.get/add/save/delete` in `src/hr/sessions.ts`. The tick is **`hr.sessions`** ("Records the tutors' sessions; sees the price only if they also see amounts"). Only people of category *tutor*; a session = person + date + activity + note, one row per session (`hr_session`). The table already has **`source`** ('hand' now, 'calendar' prepared in a comment) and **`ext_id`** with a unique index: **the door for a calendar import is already built, only the import is missing.** A session already paid (`run_line_id`) cannot be changed.
- Calendar (new): a booking has `origin = 'ours'` for our programme, an **activity kind**, a **`leader`** (a typed name, not a link to a person), **`repeat_days`** (weekly repeats) with `time_from/time_to`, and **`cal_date`** exceptions (cancel / move one day, with a reason). So the calendar knows *what, when, how often, who leads (as a name)*, and which days were cancelled or moved.
- The old proposal `hr-tutor-sessions-link.md` (Alberto website app) is **another program** (a monthly Excel file from the Alberto calendar to HR). Its idea of "the calendar knows, HR pays; no money in the calendar" is the same, but it does not fit here: in MAGIS Accounts the calendar and HR are on the **same server**, so no file is needed.
- Not found: any link between `leader` (text) and an HR tutor person; no "attendance taken" mark in the calendar.

**Problem today.** `hr.sessions` brings, through `withImplied`, the tick `hr.view`, so the person sees **the names, positions and dates of the people of the centre** in HR. That is more than a coordinator needs, and it is not salaries, but it is HR. Also the HR menu shows other sections. A narrow role must open **one page only**.

**Proposal (narrow role, then optional calendar help):**
1. **Small, now:** a role **"HR Sessions of a centre"** = tick `hr.sessions` only, plus a new rule in the HR screen: for a person whose HR rights are *only* `hr.sessions`, the HR door opens **straight on the Sessions page**, the other sections are not shown, and the list of tutors shows **name and activity only** (no centre details, no agreement, no price). The server cuts what it sends in the same way (as `scope.ts` already cuts by centre). **Coordinator (workshops)** includes this role by default (it is a role-in-role; the Director may untick it).
2. **Medium, soon:** a button **"Suggest from the calendar"** on the Sessions page: for the month and the centre, the server reads the calendar's *our programme* bookings with a `leader`, expands their weekly repeats and the exceptions (`cal_date`: cancelled days are left out, moved days use the new day), and proposes a list "Tuesday 4 · English B1 · leader Rima". The coordinator **ticks what really took place** (attendance) and confirms; each confirmed row is written in `hr_session` with `source = 'calendar'`, `ext_id = booking:date`, so doing it twice never doubles. Nothing is paid or priced by the calendar.
3. **To prepare first (small):** matching the typed `leader` with the HR tutor card. First time by name, the coordinator picks "this is Rima"; the choice is remembered. No change to the calendar's data.
4. **Later:** a "who took the attendance" mark on the calendar day, replacements ("replaced by…"), two animators on one session. Not needed for the first version.

**What it never gives:** salaries, the session price, agreements, personal details, the vault, the payroll. The price stays behind `hr.salary`.

### 9.3 The book with the user (one window)

- Today: create the **book** (Lists → Books), then create the **user** (Admin → Users) and tick the book. Two windows, two places (also `createKeepers` exists to make the accounts for books already made).
- Proposal: in the **add-person window**, when the role **Book holder** is ticked (alone or with others), the program **makes the book** with the person's name (private flag off, in the Main's city, as `users.createKeepers` does today), links it, and shows the temporary password once. Removing the person switches the book **off** (never deleted: its rows stay).
- The word "book holder" in the window: "keeps a cash book".
- **For the Accountant:** he keeps the Main book and today may add book holders (`users.holders`). He keeps that: his window is the same small window, limited to **Book holder** (no other role). He no longer needs the "Lists → Books" page for a new keeper; he does still need it to rename or switch a book off. He cannot give himself more roles. His "Users" tab shows only book holders, as now.
- An Accountant who is also a book holder: he gets his own book through the same window, given by the Director.
- Existing real users: nothing changes; their books are already linked.

### 9.4 The Administrator and the three HR databases

**Facts from Fouad:** servers are reached only by AnyDesk, not server to server; a copy travels as a **locked file** (password).

**Stage A (possible now, small–medium):**
1. On each server (as the HR keeper or Administrator there): **"Make a locked HR copy"**. The program already makes a protected copy (copy password, `src/io/protect.ts`, `protectCopy` in `server.ts`); this button makes one file of the HR database, **named with the centre and the date**.
2. The file is carried by **AnyDesk file transfer** to the Administrator's server.
3. On the Administrator's server: **"Open a locked HR copy"**: type the copy password, the program unlocks and keeps the file as a **read-only copy** with its date. This copies the way the program already keeps **copies of centres from other servers** (`/api/province/copy`: read only, nobody signs in to it, newer replaces older, an older one is refused, shown with its date). Today that mechanism accepts **centre** databases only and takes a plain file: it needs to accept `kind hr` and to unlock a locked file first. Both small.
4. **How the Administrator sees the three side by side:** one page "HR of the three centres": the three copies in three columns or a switch at the top (Jaramana · Aleppo · Homs), **each with its date of copy** ("Homs, copy of 24 Nov"). A simple total list (people, monthly amounts in dollars by centre) is built from the copies' contents. No editing.
5. **Never merged** into the live HR of the Administrator's own server. Never written to: the copy is opened read-only and the server refuses every change on it.

**What must never happen:** no cloud, no shared folder, no e-mail of the unlocked file; the locked file is deleted after opening (the copy stays inside the server's own folder); the copy password is not written in the file name or in any note; the Administrator's HR copies are **not part of any backup mirror** unless locked too; salaries are seen only by the Administrator and his second person.

**Stage B (automatic, not possible today).** It would need: the servers able to reach each other (they do not today: AnyDesk only); a secure connection between them (certificates, an address for each server, a fixed internet link); a way to let the Administrator's server **ask** and a **permission** on the other side. In practice it is the "central server" or a secure link; to be studied only when the link exists. Stage A does not block it.

### 9.5 Build steps, updated

| # | Step | Size | Model | Parallel? |
|---|---|---|---|---|
| 1 | **Roles as data** + several roles per person (union), "Exceptions" list, doors from the union, limits in the server | Medium–large | Opus (risky: sign-in) | First; alone |
| 2 | **Administrator-only Respo and Grants** (ticks only in Administrator, hidden from Advanced, check donor names for Director) | Small–medium | Sonnet | After 1; with 3 |
| 3 | **Who gives what** (Administrator → Director → others; Director's HR roles for his centre only) + the Users window with several roles | Medium | Opus | After 1; with 2 |
| 4 | **HR roles on the person** (HR keeper, HR Sessions: one account behind the scenes, same password; ring sign-in keeps working; narrow Sessions door) | Medium–large | Opus (two databases) | After 1; apart from 2–3 |
| 5 | **Book with the user** (one window; Accountant limited to book holders) | Small–medium | Sonnet | After 3 |
| 6 | **HR locked copy** (make / open read-only / three centres side by side; `kind hr` accepted; older refused) | Medium | Opus (private data) | After 1; apart from the others |
| 7 | **Sessions from the calendar** ("Suggest", leader ↔ tutor matching, confirm) | Medium | Opus | After 4 |
| 8 | **Mapping of real users on copies + before/after report** | Medium | Opus | After 1, 3, 4 |
| 9 | Guide, Arabic/English/French texts, test list | Small | Sonnet | Last |

Order: 1 → (2+3 together, 4, 6 each in its own session, different files) → 5 → 7 → 8 → 9. Two writers at the same time at most on `ops.ts` / `server.ts`. No installer, no tag: only when Fouad says "build"; every update rehearsed on copies.

### 9.6 Last questions for Fouad (only the real open points)

1. **Coordinator (workshops) and attendance:** may the coordinator take the attendance of the animators of **his centre only**, seeing only names and activities, never any pay? *I recommend yes; "HR Sessions" is a small role the Director can also give to someone else, e.g. Reception.*
2. **Calendar suggestions:** is it right that the calendar only **suggests** and the coordinator **confirms** each session (nothing automatic, nothing paid by the calendar)? *I recommend yes.*
3. **The "leader" in the calendar** is a typed name today. Are you happy that the first time the coordinator says "this is Rima" for each animator, and the program remembers? *I recommend yes; no change to the calendar.*
4. **Locked HR copy:** who makes the copy on each server, and how often (for example the 1st of each month, and before the payroll)? *I recommend the HR keeper of the centre, each month and before approving the payroll; the Administrator sees the date on every copy.*
5. **Removing a person who keeps a book:** the book is switched off, not deleted (its past stays). *I recommend yes.*
6. **Who is the second Administrator** on each server (name)? Needed before the update, to avoid locking everyone out while Fouad is away. *I recommend one trusted person per server, written in the update note.*

Nothing is built. When these are answered, the first job is step 1 (roles as data).

---

## 10. Fouad's answers to §9.6 (25 November 2026)

1. Yes: the Coordinator takes the attendance of the animators of his centre only (names and activities, never pay).
2. Yes: the calendar only suggests, the Coordinator confirms.
3. Yes, but: **who enters an animator?** Proposal (manager): **HR enters the animator** (a person of the centre, category tutor, as today); when a workshop is created in the calendar, its leader is **picked from the list of the centre's animators in HR** (names only), typed only if not there (as the inventory's "with staff" holder). This replaces the "this is Rima" matching. To confirm with Fouad.
4. HR makes the locked copy. **But HR still needs more reflection:** a general look across several HR databases, and **one project shared by two centres** (e.g. Homs and Aleppo) need the data joined. Fouad: keep the HR database as it is now, each HR keeper controls his centre; how to join them later is open. → **HR parts are paused** (step 4 HR roles on the person, step 6 locked copy, step 7 sessions from the calendar) until a separate HR reflection.
5. Yes: removing a person switches the book off, never deleted.
6. Administrators: **Fouad = the main Administrator everywhere.** Second Administrators: Alvaro (Aleppo), Julian (Homs and/or Aleppo: Fouad wrote "the secondary in Aleppo Alvaro in Homs and Aleppo Julian" — to confirm, and Jaramana's second is not named yet).

**So now:** step 1 (roles as data, several roles per person) can start; then steps 2, 3, 5. The HR steps wait for the HR reflection.

**Confirmed by Fouad (25 November 2026):** second Administrators: **Alvaro = Jaramana**; **Julian = Homs and Aleppo**. Fouad = main Administrator everywhere. Animators: **HR enters the animator**; the calendar's workshop leader is **picked from the centre's animators in HR** (names only), typed only if not there — agreed.

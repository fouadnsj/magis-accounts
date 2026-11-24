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

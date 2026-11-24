# Second review before the build of 0.13.0 — MAGIS Accounts

Written 25 November 2026 (night), branch `main` at `06a7899`. **Review only: no program code, no data, no test server was changed.**
What I did: read every fix of the first review (`aebfdd9`, `3f698df`) and everything added since (`55e97a9`, `f22a2d6`, `6faa6dd`, `e852ba2`, `ec9c540`, `79f621d`, `06a7899`, and `3672dcf`, `a466737` for the sentences and the TV); ran the **587 tests (all pass, 60 files)**; built the invented tester data with `scripts/tester-server-build.ts` into my own scratch folder (throwaway password), started a server on it on a private port, and tried things as the Administrator, the Director, the Accountant and two Book holders, from another address of the computer (so the server does not treat me as "the server computer itself").
Marks: **seen** = I made it happen on that throwaway server; **read** = from the code only; **not confirmed** = I could not check.

**Result: 2 "Must fix", 3 "Should fix", 5 "Nice to have".**

## The three things to know first

1. **A Director can borrow the Coordinator's powers through "Sign in as"** (M-A, seen). He creates a person with the Coordinator's name written in small letters, then "sees as" that person: the server then treats him as the directory's administrator — the Province account (donors, grants), the inventory totals of every centre, the list of all databases, the server status, the directory. With any HR account of his own, he also enters the HR database **as its Administrator** (salary rights).
2. **The Director and the Accountant can still take over a person who keeps a private book** (M-B, seen). The first review's fix closed "sign in as" for them, but not "reset the password": the Accountant reset the password of a Book holder whose book is private, signed in with it, and read her private book. In Homs this is Darine ("Darine") and Roula ("Canzali").
3. **The calendar money and the books are now right** (seen): a payment goes into the book of the person who took it, nobody can choose another person's book or a private book, only the Administrator moves a payment, an entry must be in the payment's book with the same type, amount and currency, and a second entry for the same receipt is refused (also with other capitals and spaces). Two small side doors remain (Nice to have).

---

## MUST FIX before the build

### M-A — "Sign in as" a person named like the Coordinator gives the Coordinator's powers to a Director (seen)
- **Where:** `server/server.ts:727-731` (`asViewOf`: the directory person of the target is found **by name**, `q.name.toLowerCase() === name`); then every check that uses `dirPerson` while someone is "as": `:752-753` (`mayCreate`), `:971-972` (`mayConfig`, `mayManage`), `:1117` (`needDirAdmin`), `:1302` (`allCentresAllowed` → `/api/province…`, `/api/coordinator/…`, `/api/main-lists`), `:1005` (`needSuperior` "coordinatorToo"); `/api/dir/enter` is allowed in "see only" (`:936`). And `src/ops.ts:1489`: a new person's name must differ from the others only **exactly** (capitals count), so "fouad" is accepted next to "Fouad".
- **What goes wrong:** the server copies the directory account of the person "seen", including `admin: true` when that name is the Coordinator's. On your servers the directory usually holds **one** person: the Coordinator. So the name is easy to guess.
- **Seen, step by step** (tester data; I made "Sample Admin" the directory's administrator, as Fouad is on a real server):
  1. Sample Director creates a Book holder named `sample admin` (small letters) — accepted.
  2. He opens 👁 "see only" on that person — accepted (the person is a plain Book holder).
  3. Now, still the Director in "see only": `/api/hello` answers `canCreate: true, canManage: true, person: Sample Admin, admin: true`; `GET /api/province` gives the Province account (books, rows, lists); `/api/coordinator/inventory` the inventory of every centre; `/api/coordinator/waiting`; `/api/dbs/manage` every database with sizes and backups; `/api/server/status` the data folder and backups; `/api/dir/people` every directory person with the databases given to each.
  4. I gave the Director an HR account of his own with the "Reader" role only. Then `/api/dir/enter {db: sample-hr}` put him into HR **as Sample Admin, HR keeper, with `hr.salary` and `hr.vault`**, in "see only". (The tester HR has no salary figures, so I saw the rights, not real amounts.)
  - Writing stays refused in "see only" (`/api/dir/save`, `/api/province/…` POST → "nothing can be saved"). It is a reading leak, but of exactly what the Administrator alone should see.
- **Fix (three parts, all small):**
  1. In `asViewOf` (`server.ts:729`): find the directory person **only by the link** (`q.grants[c.slug] === target.id`), never by name; and when the real person is not himself the directory's administrator, never keep `admin: true` — return `{ ...dir, admin: false }` (or refuse the sign-in as such a person with "the Coordinator: only the Coordinator").
  2. While `asNow` is set, every power check must use the **real** person's directory account (`realDir`), never the target's: `mayCreate`, `mayConfig`, `mayManage`, `needDirAdmin`, `needSuperior(…, coordinatorToo)`, `allCentresAllowed`, `ctyOpen`. (Seeing the target's list of databases may stay the target's.)
  3. In `keepAs` (`server.ts:1122`): when the real person goes on to another database "as" someone, require that his own account **there** also has `users.manage` (as `/api/as` does, `:2483`); otherwise refuse "go back to your own account first". (This also closes S-1.)
  - Also, in `saveUser` (`ops.ts:1489`), compare names without capitals and spaces (`lower(trim(name))`), and refuse a name equal to a directory person's name unless it is that person's linked account.
  - **Test to add:** Director creates "sample admin" → 👁 see only → `GET /api/province`, `/api/coordinator/inventory`, `/api/dbs/manage` → 403; `/api/dir/enter` into HR → refused.

### M-B — The Director and the Accountant can reset the password of a person who keeps a private book, then read that book (seen)
- **Where:** `src/ops.ts:2113-2129` (`profile.setPin`) and `src/ops.ts:1520-1523` (`user.save` with a password, for an existing person). The only protection is `guardTarget` (`ops.ts:1418`), which refuses the Administrator and Director roles only. The M5 fix of the first review blocked "sign in as" a keeper of a private book (`server.ts:712`) but not this door.
- **Seen:** I made Sample Holder 1's book private (as Darine's in Homs). The Director's "sign in as" her was refused ✓. But `profile.setPin {id: Holder 1}` answered OK for **the Director and for the Accountant** (the Accountant has the tick "resets passwords"). With the Accountant's password I signed in as Holder 1, set a new password (the forced change), and the register showed **the 10 rows of her private book** with their explanations and amounts.
- **Scenario:** a future Director or any Accountant in Homs resets Darine's or Roula's password, reads their private book, then (if he wishes) changes it back — Darine only notices that her password "no longer works".
- **Fix:** in `profile.setPin` and in `saveUser` when `a.pin` is given for an existing person: if the person giving is not the Administrator (`!isAdmin(c) && await rolesOn(c.db)`), refuse when the target **keeps any private book** (`SELECT 1 FROM user_book ub JOIN book b ON b.id = ub.book_id WHERE ub.profile_id = ? AND b.private = 1`) or holds any Administrator-only tick (`ADMIN_ONLY`), with the same words as the sign-in-as refusal ("This person keeps a private book: only the Administrator…"). People.tsx: grey the "reset password" button for such a person, like the 👁 button. **Test to add:** Director and Accountant → `profile.setPin` and `user.save {id, pin}` on a keeper of a private book → refused; the Administrator → allowed.
- (The same takeover through a password reset is also possible on the **directory** password only for the directory's administrator — `/api/dir/reset` needs `needDirAdmin` — so it is closed once M-A is fixed.)

---

## SHOULD FIX

### S-1 — Going from "sign in as" into HR (or another database) does not ask whether the real person may sign in as anyone there (read; seen as part of M-A)
- **Where:** `server/server.ts:1122-1133` (`keepAs`) and `:706-710` (`asRefusal`: a database without ready-made roles — HR — returns "allowed" for anybody).
- **What goes wrong, without the name trick:** a Director "sees as" the Accountant; the Accountant's ring includes HR (same name there, with salary rights); if the Director has **any** HR account, `/api/signin/enter {db: hr}` puts him into HR as the Accountant's HR account, salaries included. Same in a second centre database of the same house: a person who is only a Book holder there could look as its Accountant. Read; the step "enter HR as someone with salary rights" was seen in M-A.
- **Fix:** part 3 of M-A (require `users.manage` of the real person's own account in the database he goes into; and in HR refuse a target with `hr.salary` unless the real person has it too).

### S-2 — "See only" does not check what the target can see that the Director cannot (read)
- **Where:** `server/server.ts:706-720` (`asRefusal`).
- **What goes wrong:** the refusal looks at the target's **roles** (Administrator, Director) and **private books**, not at their **ticks**. An old Custom role or an exception can still carry `register.private`, `lists.donors`, `inventory.totals`, `data.download` or `hr.salary` (the first review: "nothing in `loadProfile` removes those ticks from a Custom role"). "See only" as such a person shows them to the Director. Not seen in your data today (the first review found none).
- **Fix:** in `asRefusal`, when the real person is not the Administrator, also refuse a target who has any of `ADMIN_ONLY`, `data.download`, `hr.salary` that the real person does not have.

### S-3 — The TV's key still opens the phone pack (N4 of the first review, unchanged; read)
- **Where:** `server/server.ts:2598-2608` (`/api/calphone/pack` accepts any `cal_phone` key) and `src/hosting/calops.ts:795` (`phoneAdd`: a TV is an ordinary calendar phone with any role).
- **What goes wrong:** the TV itself receives only the cut screen ✓ (`tvPack` cuts as Team, `server/calphone.ts:55`). But its key, kept in the TV browser's storage, also works on `/api/calphone/pack`; a TV linked with the role Reception, Coordinator or Director returns **contacts** (phone numbers of groups) for the seven days around today to whoever copies the key from that browser on the wall.
- **Fix:** mark a TV (`cal_phone.role = 'tv'`, or a column `is_tv`) when its code is made from the TV page, refuse `/api/calphone/pack` for it, and refuse `/api/tv/screen` for a non-TV phone; until then, the guide should say "make the TV's link code with the role Team".

---

## NICE TO HAVE

- **N-1 — Two side doors around "one entry per receipt" (read).** `checkCalReceipts` is skipped for a row put back from a backup (`src/ops.ts:286`, `restoring: true`; Administrator only) and for the rows of a holder's file imported in the office (`src/io/keeperFiles.ts:156`, `entries.import`, which does not go through `saveRows`). A holder who types H2026-0008 in her offline program and also makes it from "Payments waiting" would give two entries. Fix: call `checkCalReceipts` in both places (in the import: send such a row to "review" instead of refusing the whole file).
- **N-2 — A receipt number typed with an extra character is not recognised** (read): "H2026-0008." or "H 2026-0008" is not matched, so the check does not run and the payment stays "waiting" (it can then be entered properly, and the hand-typed one is a duplicate nobody links). Fix: compare without spaces and punctuation, or warn when an entry's receipt looks like `H\d{4}-\d{4}` but matches no payment.
- **N-3 — A refund follows the book of the payment even when that book has since become private, been switched off, or its keeper left** (read, `src/hosting/calops.ts:486-489`): only the Administrator can then enter or move it (`cal.pay.book`, `calops.ts:876`). Fine as a rule; the waiting page could say "only the Administrator can enter this one".
- **N-4 — Update 78 was reshaped under the same number** (N1 of the first review, unchanged). Still no file found with the first version; cheap insurance is `CREATE TABLE IF NOT EXISTS sentence` in a later update.
- **N-5 — My mistake tonight:** I started the server once without `--data`, so it created an **empty folder `~/MAGIS-server`** (config.json, an empty `dbs`, and a `tls` folder it generated; time 02:27) on this Mac. It holds no data and I did not open `tls`. It can be deleted; if this Mac is ever used as a real server with the default folder, delete it first.

---

## The fixes of the first review — checked

| | Verdict | How |
|---|---|---|
| **M1** payments reach the books | ✓ complete | seen: Holder 2 (Book holder + Coordinator) sees only her own book's payments; the Accountant the Main book's + a plain count "elsewhere"; Holder 1 (no money tick), the Director: refused. The rows carry receipt, date, amount, currency, kind, group, code, book, hint — no price, contact or note. |
| **M2** balance / closing problems of a private book | ✓ | seen: Director `bookMonth.balance` on Respo and on a private holder book → refused; Accountant `closing.problems` → refused; the whole-centre list says "private book". |
| **M3** closing / counting a private book | ✓ | seen: Accountant `bookMonth.close` on Respo → refused; read: `cash.saveCount`, `envelope.save`, `trx.approve` refuse too. |
| **M4** audit trail | ✓ | seen: 208 lines for Director and Accountant, none about Respo or the private holder book. |
| **M5** sign in as | ✓ for `/api/as` itself (seen: Director "act" → refused; as the Administrator → refused; as a keeper of a private book → refused; "see only" as the Accountant: writes refused) — **but incomplete:** M-A (name), M-B (password reset), S-1 (going on to HR). |
| **M6** server controls | ✓ for the Director himself (seen: `/api/province`, `/api/coordinator/inventory`, `/api/dbs/manage` → 403) — **but reachable again through M-A.** |
| **S1** users.* ticks | ✓ read and tested (`tests/security-before-build.test.ts`). |
| **S2** large-expense controls | ✓ read (`holdsControls`, `settings.save`, `mayApprove`). |
| **S3** one entry per receipt, entry = payment | ✓ seen: Accountant in Main for a holder's payment → refused ("belongs to the book Sample Holder 2"); Holder 1 in her own book → refused; the Administrator in Main → refused; 49 instead of 50 → refused; the right entry → saved; the same again with " h2026-0008 " → refused; twice in one save → refused; changing the saved entry to 5 USD → refused; the waiting list drops it at once. Two side doors: N-1. A double click cannot pass: on the server every operation runs to its end before the next one starts (the database calls do not wait on anything), so the check and the write are not separated (read). |
| **S4** copy mark | ✓ read: the count is taken first, one print at a time (`calops.ts` `printQueue`). |
| **S5** Arabic words, whole pounds | ✓ read + `tests/words.test.ts` (43 amounts) pass; SYP rounded when recorded (`calops.ts` `addPay`). |

## CHECKED AND FINE (new code since the first review)

- **Update 79** (`src/db/migrations.ts:2581`): two `ALTER TABLE host_pay ADD COLUMN` (nullable; old payments stay "Main"); runs in one transaction with its number like every update, so a stop in the middle leaves 78; it cannot run twice. The table exists in every kind of database (the third rehearsal, `a9c69b4`, ran it on copies of the real Homs, Homs St François Régis, Al-Ard, Aleppo, HR, Syria files). **Update 78** only creates `sentence` (read).
- **Choosing the book of a payment** (seen): Holder 2's choices are Main and her own book; Holder 1's book → refused; Respo → refused; only the Administrator may move a payment (`cal.pay.book` → refused for Holder 2); never into a private book, never once entered (read). A refund follows the payment's book (read).
- **The Accountant never writes in a holder's book** (seen: "Your own book only"); **a Book holder never writes in Respo** (seen); the Accountant cannot make a second keeper of a holder's book (seen: refused). The Director can (seen) — that is his job by design.
- **Sentences** (`src/sentenceOps.ts`): reading the pool needs a session; changing needs Administrator or Director (`peopleDoor`); length capped; parameters in every query. They are shown on the doors page by React (no HTML is ever interpreted) and on the TV with `textContent` (`server/tv-page.ts:132-138`); the only `innerHTML` there is `= ''` to empty a box; colours go through the style properties, not HTML. **No script injection possible** (read).
- **The TV** (`server/calphone.ts:55`, `src/hosting/caltv.ts`): cut like a Team phone whatever its role: no prices, payments, contacts, notes, leaders, cancel reasons; private bookings "Reserved · محجوز"; only today; plus the centre's colour, logo, sentences (read). Only S-3 remains.
- **Every new operation** (`cal.pay.waiting`, `cal.pay.books`, `cal.pay.book`, `sentence.*`) goes through `/api/op`, which needs a session and refuses writes in "see only"; `cal.pay.waiting`/`cal.pay.books` are read-only by name (read; seen for the refusals).
- **Error messages** name only non-private books ("belongs to the book Sample Holder 2") or say "private book" (seen/read).
- **"Databases · new"** (`55e97a9`), **the top bar and Guide button** (`79f621d`), **the entry window** (`e852ba2`, `ec9c540`): screen only; the server rules are unchanged; the `hint` added to the waiting rows is a word (stay/hall/ours) computed on the server, no price or contact (read).
- **Old Payments tab removed** (`f22a2d6`): `host.pay.refuse` gone, tests pass; `host.pay.add` (old) remains and still needs the old `hosting.*` ticks (Administrator only) — writes into Main (read).
- **Tester server script** (`06a7899`): all names and amounts invented ("Sample …"); refuses any path with `real-db` (also through links); the password is only an argument and is stored salted and hashed (I searched every file it made for my throwaway password: **not found**); `--rebuild` moves aside only a folder it made itself; the directory it writes has nobody as directory administrator (so the Coordinator pages cannot be tried there — fine for a tester).

## What I did not check
The Tauri desktop app; HR operations beyond who reaches them; the look of the screens (no browser); real salary figures (the tester HR has none); the Province routes beyond their gate; the old 0.12 hosting operations beyond their ticks.

## Where the evidence is
Scratch folder (outside the project, safe to delete): `/private/tmp/claude-501/-Users-fouadsj-Documents-Claude-Projects-Comptability/03859cca-562b-462e-bd94-97270dbd51d9/scratchpad/` — `ts1/` (the invented tester data, changed by my probes), `probe.sh`, `probe2.sh`, `who.sh`. The server I started there is stopped.

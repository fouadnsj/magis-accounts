# Review before the build of 0.13.0 — MAGIS Accounts

Written 25 November 2026, branch `main` (last real release: tag `v0.12.1`; 75 commits and 142 files since). **Review only: no program code, no data, no test-server was changed.**
What I did: read the code of the three risk areas, ran the 486 tests (all pass), wrote small throw-away programs (in a private scratch folder, not in the project) that start a real server on an empty database and try things as a Director, an Accountant, a Book holder, and rehearsed the updates on copies of your real databases.

**Result: 6 "Must fix", 6 "Should fix", 6 "Nice to have".** Everything below was either seen happening (marked **seen**) or read in the code (marked **read**). Where I could not confirm, I say "not confirmed".

## The three things to know first

1. **The Respo (private) book still leaks to a Director and an Accountant** through three side doors: its balance, closing its month, and the audit trail (M2, M3, M4). The screens hide it; the server does not.
2. **A Director can take over another Director's account** and, through "Sign in as", can act as nearly anybody except the Administrator (M5). The code comment says the server refuses this; it does not.
3. **The money the Calendar suggests to the books has no screen any more** (M1). Since the doors page, the old "Payments" tab (where the accountant turns a payment or a refund into an entry) is no longer reachable.

---

## MUST FIX before the build

### M1 — The "Payments" tab no longer exists: calendar payments and refunds can never be made into entries of the books
- **Where:** `src/ui/Shell.tsx:49` (the list of pages has no `hosting`); `src/ui/Hosting.tsx:1128` (`PaymentsTab`, the only place that has the "Make the entry" button and fills the receipt number); `src/ui/Calendar.tsx:616` ("waiting for the books"). The tab was cut off from the menu by commit `b23de65` (the doors page). `CHANGES-NEXT.md:203` still says "the books' Payments tab makes an expense of it".
- **What goes wrong:** the new Calendar records each payment (H2026-0001) and each refund (HR2026-0001) as "a suggestion for the books"… but nobody can see the list of suggestions, and the Accountant cannot even see the amounts (the Accountant has no `cal.money` tick, so the server sends `pays: []`).
- **Scenario:** the Coordinator records $200 from a group and prints the receipt H2026-0007. The Accountant has nothing to open. Either the income never reaches the books, or he types it by hand and forgets or mistypes the receipt number; the booking then shows "waiting for the books" for ever. A cancelled booking whose money is given back has the same problem with the expense.
- **Fix:** give the people who write entries (Accountant, Administrator) a small "Payments waiting for the books" list in Accounts, fed by a new server operation that returns only: receipt number, date, amount, currency, group name, kind in/back (no prices, no contacts). Its "Make the entry" button opens the entry form already filled (the code for that exists in `Hosting.tsx:1135-1141`). If you prefer to postpone, say so in the guide and tell the accountants to type the receipt number in the "Receipt" box of the entry.

### M2 — A Director or an Accountant can read the balance of the Respo book
- **Where:** `src/ops.ts:1973` (`bookMonth.balance`), same weakness in `closing.problems` at `src/ops.ts:1662`.
- **What goes wrong:** both operations only ask "do you have `register.view`?" and never ask "is this book hidden from you?" (`hiddenBook` exists, `src/ops.ts:293`, and is used elsewhere).
- **Seen:** on a test server with a Respo row of $4,321, `bookMonth.balance {bookId: Respo, ym: 2026-05}` answered `{"syp":0,"usd":4321}` to **both** the Director and the Accountant.
- **Fix:** at the start of both, `if (hiddenBook(c, await loadLists(c.db), a.bookId)) throw refuse();` — one line each.

### M3 — The Accountant can close the month of the Respo book
- **Where:** `src/ops.ts:1920-1925` (`bookMonth.close`): "if you don't keep this book you need `month.close`" — the Accountant has `month.close`; nothing checks that the book is private.
- **Seen:** the Accountant called `bookMonth.close` on the Respo book (May) and the server said yes (200). It wrote a month-closing line, a cash-count history line and an audit line with the Respo money in them. Only the Administrator can reopen it (`month.reopen`).
- **Fix:** same one-line refusal as M2 (for writing: a book you do not keep and may not see, you do not close).

### M4 — The audit trail shows the Respo book's money to Director and Accountant
- **Where:** `src/ops.ts:656-670` (`auditFor`): it hides audit lines about private rows only when the table is `trx`. Lines of the tables `book_month` and `cash_count` (their `row_id` is the book) pass.
- **Seen:** after the Accountant's closing above, the Director's `audit.list` contained `book_month 1|2026-05 … "book":{"usd":4321} …"counted":{"usd":4321}`.
- **Fix:** in `auditFor`, also drop lines whose table is `book_month`, `cash_count`, `cash_count_log`, or `book` (the part of `row_id` before `|` is the book id) when that book is hidden from the person.

### M5 — "Sign in as" is not limited to what the screen says: a Director can become another Director and take over the account
- **Where:** `server/server.ts:2460`: the only refusal is `target.admin` (the Administrator). `src/roles.ts:187` says "the server refuses those too" (Administrator **and Director**) — it does not.
- **Seen:** Dina (Director) signed in as Dora (Director) in "see and act" mode (200), used the ordinary change-password operation as Dora (it counts as "my own password", `src/ops.ts:2077`) and then logged in as Dora with the password Dina chose. A direct reset of Dora's password by Dina is refused ("For the Administrator only") — the sign-in-as door goes around that.
- **Wider effect (read, and seen for the Accountant):** as a Director, "act as" the Accountant lets him write in the Main book and close months (his rights are the target's); "act as" the holder of a private book gives him that private book. **In your real Homs data, two ordinary Book holders keep private books** (Darine keeps "Darine", Roula keeps "Canzali"; the Respo book is Fouad's). A future Director could sign in as Darine and read it.
- **Fix:** in `/api/as`, when the real person is not the Administrator: refuse a target who holds the Administrator or Director kind (as the screen already does), refuse a target who keeps a private book, and allow only "see only" (not "act"). Also refuse `profile.setPin` while `s.as` is set.

### M6 — A Director (who has `users.manage`) can reach the server's own controls
- **Where:** `server/server.ts:947` (`mayManage`), `:730` (`mayCreate`), `:2733` (`/api/server/copy-password`), `:2766` (`/api/server/config`), `:999-1066` (`/api/dbs/manage|state|delete|restore`). All were written when only the Superior had `users.manage`; the Director has it now.
- **Seen (all answered 200 for a Director):** `/api/server/config` set the **backup folder** to any path he typed; `/api/dbs/manage` listed every database of the server (names, sizes, backups); `/api/server/copy-password` **set the copy password** (when none is set yet). Read: with his own password a Director can switch off or "delete" (move to the `deleted` folder) his own centre's database, and **restore** a deleted database with no password at all; he can create and import databases.
- **Scenario:** the Director sets the backup folder to a shared folder. While no copy password is set, every daily backup of **every centre on that server** (with donors, Respo, hashes) is copied there unprotected. If the copy password is set, the copies are encrypted — please tell me whether it is set on the real servers.
- **Fix:** these gates need `has(profile,'users.manage') && profile.admin` (the Administrator) or the directory administrator or the server computer itself. Same for the large-expense approval controls (see S2).

---

## SHOULD FIX

### S1 — A Director can hand out `users.manage` as an "exception" and make new de-facto Directors
- `src/ops.ts:1430-1444`: the Director may give any tick he has himself; he has `users.manage`, so he can give it to a Book holder as an "Advanced" exception. **Seen:** `user.save` with `extra:["users.manage"]` answered 200. That person is not of the kind "Director" (so M5-style protections do not cover him) but can reach all of M6.
- **Fix:** add `users.manage`, `users.holders`, `users.passwords` to the list that only the Administrator may give (next to `ADMIN_ONLY` in `src/roles.ts:32`). Giving `data.restore`, `data.backup`, `hr.salary` was refused ("You cannot give more than you have") — good.

### S2 — The Director holds the Superior's controls on large expenses
- `src/ops.ts:156` and `:1824-1828` (`settings.save`): the keys "documents required", "approval on", "approval amount", "who approves" need `users.manage` — the Director can switch the approval rule off or raise it. `:165` (`mayApprove`): when no approving role is chosen, **whoever has `users.manage` approves** — i.e. the Director. Read, not run.
- **Decision for you:** are these the Administrator's alone? I would say yes (same fix as M6).

### S3 — The same receipt number can become two entries, and the entry is not compared with the payment
- `src/ops.ts` `saveRows` has no check on `receipt`; the table `trx` has no unique index on it (`migrations.ts:235`). The Calendar only checks "is there some entry with this receipt" (`calops.ts:41`).
- **Scenario:** two people (or one double click) make the entry for H2026-0007; the income is counted twice. Or the accountant changes the amount in the pre-filled form to $20 instead of $200: the booking says "in the books ✓".
- **Fix:** refuse a second entry with a receipt number of a payment that is already entered; show a warning (not a block) if the amount, currency or type differs from the payment.

### S4 — The "copy" mark can be missing on a second print
- `src/ui/CalPaper.tsx:61-67`: the "copy" mark is decided from the number of prints the screen **already loaded**, and the print counter is raised after saving. Two people with the same booking open, each press print: both prints are "originals".
- **Fix:** call `cal.paper.printed` first (it answers `before`, the number of earlier prints, `calops.ts:758`) and print the mark when `before > 0`.

### S5 — Arabic amounts in words are not always grammatical; SYP decimals are dropped
Output of `amountWords` (`src/hosting/words.ts`), checked by running it:

| Amount | Arabic | English |
|---|---|---|
| 0 USD | فقط صفر دولارات أمريكية لا غير | Zero US dollars only ✓ |
| 1 / 2 / 10 USD | دولار أمريكي واحد · دولاران أمريكيان · عشرة دولارات أمريكية ✓ | ✓ |
| 11 USD | أحد عشر دولاراً أمريكياً ✓ | Eleven ✓ |
| 100 / 1000 / 1,250 USD | مئة دولار · ألف دولار · ألف ومئتان وخمسون دولاراً ✓ | ✓ |
| 1,250.50 USD | …وخمسون سنتاً ✓ | …and fifty cents ✓ |
| **102 USD** | مئة **واثنان دولار** (should be: مئة ودولاران) | ✓ |
| **11 SYP** | أحد عشر ليرةً (should be: إحدى عشرة ليرة) | ✓ |
| **12, 13 SYP** | اثنا عشر / ثلاثة عشر ليرةً (feminine: اثنتا عشرة / ثلاث عشرة) | ✓ |
| **1,250.75 SYP** | words say 1,250: **the 0.75 is silently dropped** | the figure printed says 1,250.75 |

- A receipt where the words and the figure disagree is a problem for an accountant. **Fix:** round SYP amounts to whole pounds when the payment is recorded (`calops.ts:643`, the form accepts decimals), and correct the Arabic for 11–19 with a feminine noun and for numbers like 101–102 (one/two after a hundred). The English is right in every case I ran.

### S6 — Check on the real servers: is the copy password set? (not a code bug)
Needed to size M6. If it is not set, the backup folder is the sharpest edge of M6.

---

## NICE TO HAVE

- **N1 — Update 78 was changed after it was first built** (commit `c6bc174` made a table `cal_tv_phrase`, `3672dcf` made it `sentence`, same number 78). Any database that took the first version (only possible in the 17 minutes between the two commits) is marked "78 done" and would never get `sentence`; the TV and the doors page would then fail with "no such table". **Not confirmed on any file:** I scanned every `magis.db` in `real-db/` and `test-servers/`: none has `cal_tv_phrase`. Cheap insurance: make the sentence queries tolerate a missing table, or add a harmless update 79 `CREATE TABLE IF NOT EXISTS sentence`.
- **N2 — Payment date: the screen uses local time, the server UTC** (`src/ui/kit.tsx:56`, `calops.ts:29`). In Syria between 00:00 and 03:00 the default date is "tomorrow" for the server and the payment is refused as "in the future"; the refund rows (HR…) are dated by UTC.
- **N3 — The numbers HR2026-000x of a refund can be reused** when the decision is changed before it is entered (`calops.ts:378-402` deletes the waiting rows and numbers again). No receipt is printed for refunds (the print button is hidden for them), so I found no harm; just do not copy such a number elsewhere.
- **N4 — The TV receives more than it shows:** `phoneCut(...,'team')` sends 7 months of bookings with `leader`, `note`, `people`, `outside_place` to the TV browser (`server/calphone.ts:59`); and the TV's key also opens the phone route (`/api/calphone/pack`), so a TV created with the "Director" role would hold a key that returns contacts. Suggest: a TV pack of today only, without notes and leaders; always cut as Team.
- **N5 — Old 0.12 operations are still callable** (`host.booking.save`, `host.pay.add`, `host.get`…, `src/hosting/ops.ts`). They need the old `hosting.*` ticks (only the Administrator role and old hand-made roles have them), but they ignore the new rules (private, closed periods, whole centre). Removing the unreachable `Hosting.tsx` operations once M1 is settled would close this.
- **N6 — Small things:** the roles tick `inventory.totals` hides the ready-made **sums** only; each item's value reaches the Director and the keeper, who can add them up (by design, see "checked"); a person whose password is reset by the Administrator keeps his open sessions until idle timeout; two phones typing the same link code at the same moment could both get a key (`server/calphone.ts:23-30`, the update is not conditional) — only matters for someone who already knows the code; the cancel reason of a non-private booking is visible to everyone who sees the calendar.

---

## DATABASE UPDATES 57 → 78 — what I rehearsed

**Method:** copied the newest `real-db` files (`magis-homs`, `magis-al-ard`, `hr-sj`, `homs-st-francois-regis`, `syria`, `MAGIS/province`, the `aleppo` daily file, and the older `MAGIS/dbs/*` copies: 12 files) into a private scratch folder, ran `scripts/rehearse-roles.ts` (the program's own migration code), **twice** on each, then compared with the real files opened read-only. Then deleted the copies. **SHA-256 of all 12 real files before and after: identical.** I did not open the `tls/` folder.

| Result | |
|---|---|
| Files | 12 (centres Homs, Al-Ard, demo; HR; community Homs St François Régis; country Syria; Province; "aleppo" daily file) |
| Update reached | **78 on all 12**, 21 updates applied to the older ones, 15 to the 63-level ones, 28 to the Aleppo file (50 → 78) |
| Errors | 0 |
| Second run | applied 0, changed nothing, on all |
| `integrity_check` / foreign-key check | ok / 0 problems, before and after, on all |
| Rows lost in any table | none (every table compared by count) |
| People with fewer rights than before | 0 |
| Table `sentence` (update 78) | **created on all 12, 0 rows on purpose** (the sentences live in the code; the table keeps only what a centre changes), unique index `sentence_key` present |
| Roles other than Administrator carrying the Respo book, donors or grants | **none** (queried in Homs, Al-Ard, Aleppo file) |
| Time | 35–64 ms per database |

- **Crash in the middle:** each update runs in one `BEGIN IMMEDIATE … COMMIT` together with the line that records it (`src/db/db.ts:40-60`, `server/server.ts:198`), so a stop in the middle leaves the database at the previous update, never half-done; the server also copies the file as `…_before-update-0.13.0.db` first (`server/server.ts:514`).
- **Updates that rebuild tables:** update 41 (the budget lines "account" change; old Aleppo) rebuilds `budget_amount` and `budget_item`; it deliberately drops the amounts of funds marked "outside the budget" and the items of such funds (its comment says so), and the item copy joins on `account`, so an item with no account would not be copied (**not confirmed** that such an item exists). The real Aleppo (493 rows, update 35) was rehearsed in your first rehearsal and passed; the file now in `real-db/aleppo` is a "MAGIS Demo" backup, so I could not repeat it. Update 37 (`hr_run` rebuild) uses `defer_foreign_keys`, same story, older than 57. Updates 64–76 (calendar, inventory) and 77–78 only add tables and columns and update the role lists.
- **Update 77 (roles):** the Superior becomes Administrator (same ticks, no one loses anything); Director, Accountant, Book holder, Reception, Coordinator, Store keeper added if missing. Old hand-made roles are untouched ("Custom"): they **keep any tick they already have**. In the real data none carries donors or the Respo book, so nothing leaks today, but nothing in `loadProfile` removes those ticks from a Custom role (`src/roles.ts` `unionPerms`): a restored old backup or a copied database with such a role would give them again. Cheap insurance: strip `ADMIN_ONLY` ticks of non-Administrator roles when the profile is read.
- **Update 66** gives 11 calendar ticks to every role with `users.manage` — also in HR, community and country databases (the rehearsal lists "Calendar" among their doors). Whether the doors page really shows a Calendar door there: **not confirmed** (I did not open the screen).

---

## CALENDAR MONEY AND RECEIPTS — what I checked

- **Counted twice / lost:** payments have a unique receipt number in the database (`receipt_no UNIQUE`, `migrations.ts:2008`), so two payments cannot share a number; "taken back" payments (`refused`) are excluded from what was received (`calendar.ts:388`); a cancelled booking accepts no payment and no taking back (`calops.ts:643-668`). The remaining ways to count twice are in the books' side: M1 and S3.
- **Cancelled booking vs the books:** kept / given back / part kept: refund rows are separate rows `kind='back'`, one per currency; changing the decision replaces the waiting rows; once a refund is an entry of the books it can no longer change and the booking cannot be put back (`calops.ts:378-401`). Correct by reading. The disagreement risk is only M1 (nobody turns them into entries).
- **Numbers repeat or skip:** per year and per prefix (H / HR), `max + 1` (`host.ts:435`); a refused payment keeps its number (no reuse); refund numbers can be reused (N3).
- **Currencies mixed:** every total is per currency; a booking in USD can take a payment in SYP and the "still due" stays per currency (`calendar.ts:388-402`). ✓
- **Amount in words:** see S5.
- **Receipt for the wrong booking:** the payment receipt is built from the payment's own booking (`CalPaper.tsx:55-67`); the whole-booking receipt from the booking. I found no mix-up. **Not checked:** the visual layout of the PDFs.
- **Suggestions duplicating when re-sent:** the phone's booking save is keyed (`client_ref`, answer "already"). The books side: S3.
- **Reception and phones never see amounts:** Reception has no price tick; the calendar phones and the TV drop prices, payments, services' amounts and contacts by role (`calphone.ts:43-61`, `calops.ts:75`) — read; a person who cannot see prices does not change a booking's price when saving it (`calops.ts:252-262`). A view-only person (Book holder) got no pays/lines/orgs and was refused on every write I tried (seen).

---

## CHECKED AND FINE

- 486 tests pass (54 files).
- **A Director cannot give the Administrator or Director role** by any route I tried: in the `roles` list, as a text id, as the old single `access_id`, or by editing the Administrator's line (all refused: "For the Administrator only"); cannot give himself or others more than he has (`data.restore`, `data.backup`, `hr.salary` refused); nobody gives himself a role; only the Administrator creates, edits or deletes a role (`access.save`, `access.delete`); the "kind" of a role cannot be set from a request; the Respo/donor/totals ticks are refused for every role except Administrator, and for exceptions. The last Administrator cannot be removed or switched off (checked by reading `keepAManager`, `src/ops.ts:1344`, with rollback).
- **No password, hash, key or link code is sent to any screen:** `users.list`, `access.list`, `phone.list`, `cal.phone.list` (the link hash is read but not returned) answer names and ticks only; sign-in lists show names and role names.
- **"Sign in as" in "see only":** every write is refused by name (seen: booking save → "nothing can be saved"; server config → 403); the databases list is the target's, not the real person's (seen: only the target's database).
- **Calendar phone and TV link codes:** 8 letters from 31 (no look-alikes) = about 8.5×10¹¹ possibilities; valid 30 minutes; used once (the hash is removed when claimed); wrong codes count in the same lock as passwords (8 mistakes → 5 minutes); the long key (256 bits) is stored only as a hash and compared in constant time; a cut phone is refused at once; a phone gets a pack without prices, payments or (for Team) contacts; private bookings show "Reserved" on every phone.
- **Sessions and requests:** random 256-bit session ids, `HttpOnly; SameSite=Lax` (+ `Secure` over https), idle timeout, a switched-off person is out at once; JSON only, no state change on GET (so the usual cross-site form trick does not work); the static files cannot be escaped (`..` is refused); `dbs/restore` only accepts a plain folder name; `cal.paper.printed` chooses the table from a constant (no SQL injection); the sentence and calendar operations I read use parameters. The TV page writes text with `textContent`.
- **Sentences pool:** reading is open (they are only sentences); writing needs Administrator or Director; length capped; stored per centre.
- **Inventory:** a person without the tick gets `inv.get` refused; with values but without `inventory.totals`, the server does not send the sums and refuses the donor report (`inv.report.project`, `inventory/ops.ts:513`); the keeper's phone pack has no values. By design the Director and the keeper do receive each item's value.
- **Donors and grants:** `data`, `budget.get` (no donor), `grant.*`, `lists.export`, `province.sends` and the audit's donor tables are cut or refused for non-Administrators (tests `respo-admin-only` pass; I added probes for the side doors above).
- **Backups:** downloading a full copy needs `data.download` (Administrator only) and a copy password; the Accountant can make but not download one.

## What I did not check
The whole 142-file diff (I read the three risk areas and the code they call); the Tauri desktop app; HR, community and country operations beyond their user management; the look of the PDFs and of the screens (no browser run); private bookings and the calendar phone as running programs (read, and the data-cut functions read; my test booking needed an organisation I did not create); the sign-in directory (`/api/dir/*`) and the Province routes except their gates.

## Where the evidence is
Throw-away probe programs and logs: `/private/tmp/claude-501/-Users-fouadsj-Documents-Claude-Projects-Comptability/00a48017-be3b-4bfd-b246-9b1c45a2c36b/scratchpad/` (probe1.ts, probe2.ts, words-check.ts, cmp.mjs) — outside the project; safe to delete.

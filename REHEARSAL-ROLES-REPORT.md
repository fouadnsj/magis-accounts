# Rehearsal of the updates 57 → 77 on copies of the real databases — who can do what, before and after

## Fourth rehearsal, the new Aleppo file (26 November 2026)

**What the file is:** `real-db/aleppo/magis_2026-11-25_005737_daily.db` (25 November, 778 KB) is the **real Aleppo**: the organisation inside is
**"MAGIS Aleppo"**, made on 30 October from "Magis budget (Basis, Aleppo)", at **update 50**, with **19 register rows** (31 October to 19 November), 89
budget lines, 16 headings, 5 parties, 4 books (Main, Respo, الاستقبال, and a phone book) and **3 people: Fouad, Salim and وصفي بكره جيه**. It is *not* the demo.
(The 493 rows of the first rehearsal were an older import file; this one is the live database, with the real entries so far.)

**Result: passes.** 29 updates (50 → 79) ran in 62 ms, **no error**, integrity ok before and after, no broken link, **a second run changes nothing**,
no table lost a row (register 19 → 19, budget 89 → 89, audit 126 → 126, people 3 → 3), only the roles list changed in the old tables. `host_pay` has its
two new columns, the sentences table is created (empty). The real file is unchanged by checksum; the copy is deleted. **Nobody has less.**

| Person | Today (old profile) | After: role | Rights | Doors before → after |
|---|---|---|---|---|
| **Fouad** | Superior | **Administrator** | more (+21: the Respo book, the whole calendar, the inventory with values and big totals, downloads) | Accounts, Administration → **+ Calendar, Inventory** |
| **Salim** | Accountant **who also manages the users** | stays his old profile, **Custom** (not the ready-made Accountant) | more (+20, see the warning) | Accounts, Administration → **+ Calendar, Inventory** |
| وصفي بكره جيه | Book holder (book الاستقبال) | Book holder | same | Accounts |

**⚠ Salim needs your attention.** Salim's Accountant profile in Aleppo is not an ordinary accountant: it **manages the users**, restores backups, and
(because it manages users) an older update **gives it the Respo book** (`register.private`), together with the calendar prices, the inventory
(keeping it and its values) and downloads. So after the update **Salim sees the Respo book**, which the new rule keeps for the Administrator only; the program
did not take it away (nobody is locked out or loses anything), and it shows up as the "old role" notice on the People page. He does **not** have the
donors and grants. Because of this the update did not turn his profile into the ready-made Accountant; a ready-made "Accountant (2)" role was added, given to
nobody.

**To decide by Fouad (Aleppo):**
- ☐ **Fouad** stays Administrator (as you said).
- ☐ **Julian** has no account in Aleppo: add him as second Administrator (in *Administration → People*, after the update).
- ☐ **Salim**: what is he? Keep as he is (a Custom role with the Respo book), or make him **Director** (looks at the books, keeps the whole calendar, gives the
  other roles, no Respo, no donors), or the ready-made **Accountant** (writes in the Main book, closes months; he would then lose managing the users and the
  Respo book, which is a deliberate choice, not something the update does)? Nothing happens to him until you change it.
- ☐ Is there another centre boss for **Director**? (nobody else is Superior-only.)
- Names: HR still has only Fouad. Salim and وصفي have no HR account (as today).

---

## Third rehearsal, updates up to 79 (26 November 2026)

Same files as the second rehearsal (the newest in `real-db/`: Homs, Al-Ard, HR, community, country, Province, the old demo, and the "aleppo" file, which is
a demo), same rules: copies in a private scratch folder, deleted afterwards, real files unchanged by checksum. The code now goes up to **update 79**
(78 = the sentences of a centre; 79 = a calendar payment belongs to a book).

**Result: everything passes.** 8 copies, **0 errors**, integrity ok before and after, no broken link, **a second run changes nothing**, no table
lost a row (Homs register 814 → 814), nothing changed in the old tables except the roles list and the calendar space kinds. **Nobody has less
(0 people)**, and the people and roles are the same as in the second rehearsal (below): Homs, Al-Ard, Province and the demo Superior become Administrator,
the Accountants and Book holders keep their roles, HR / community / country / Ghassan stay Custom. (The demo Superior now shows +17 instead of +16: it
also gets the new inventory big totals, Administrator only.)

| File | Update before → after | Ran | Time |
|---|---|---|---|
| Homs | 63 → 79 | 16 | 37 ms |
| Al-Ard, HR, community, country | 63 → 79 | 16 | 35–38 ms |
| Province, demo | 57 → 79 | 22 | 43–45 ms |
| "aleppo" file (a demo) | 50 → 79 | 29 | 49 ms |

- **Update 79:** `host_pay` has the two new columns `book_id` and `by_profile` in all 8 copies. **No copy holds a calendar payment yet** (`host_pay` is
  empty everywhere, Al-Ard has one booking but no payment), so "existing payments stay on the Main book" could not be seen on real data: adding a
  column leaves every existing row empty (= Main book) by the way SQLite works.
- **Update 78:** the `sentence` table is created in **every** database (not only the centres: HR, community, country and Province get it too, empty and
  unused) and is **empty** everywhere: it is not seeded, because the warm sentences stay in the program and the table only holds what a centre changes
  or writes.
- Not covered, as before: the server, the screens and the phone app. The real Aleppo (30 October) is still not available to repeat (first rehearsal below).

---

## Second rehearsal, newest backups (25 November 2026)

Same method and same rules as the first one (below): I copied the newest files you put in `real-db/` (taken 24 November, evening), worked only on the
copies in a private scratch folder, and deleted them. I compared the checksum of every real file before and after: **the real files are unchanged**.
No installer, no tag, no program code changed.

**Result: everything passes again.** No update failed, the database check says "ok" before and after on all 7, a second run changes nothing, no
table lost a row, and **nobody has less than before** (0 people with fewer rights).

| File | What it is | Update before → after | Ran | Time | Main rows before → after |
|---|---|---|---|---|---|
| `magis-homs/magis.db` | **MAGIS Homs** | 63 → 77 | 14 | 47 ms | register 814 → 814, books 10, people 7, audit 587 |
| `magis-al-ard/magis.db` | **MAGIS Al-Ard** | 63 → 77 | 14 | 39 ms | people 2, books 2, audit 47 (no register rows yet) |
| `hr-sj/magis.db` | **HR** | 63 → 77 | 14 | 42 ms | people 1, audit 79 |
| `homs-st-francois-regis/magis.db` | **community** (Homs, St François Régis) | 63 → 77 | 14 | 37 ms | people 8, books 8 |
| `syria/magis.db` | **country** (Syria) | 63 → 77 | 14 | 45 ms | people 1 |
| `MAGIS/province/magis.db` (the older one: no newer file) | **Province** | 57 → 77 | 20 | 64 ms | people 2, books 3 |
| `aleppo/magis_2026-11-24_005738_daily.db` | **see the warning below** | 50 → 77 | 27 | 54 ms | register 32 → 32, people 5 |

In all of them the only old tables whose content changed are the list of **roles** (that is the purpose) and the list of space kinds in the calendar
(six kinds added, "Other" moved to the end). Nothing else moved.

**⚠ The "Aleppo" file is not the real Aleppo.** `real-db/aleppo/magis_2026-11-24_005738_daily.db` is a daily backup of the server's database called
*aleppo*, but inside it is named **"MAGIS Demo"**: a test database (32 register rows; people Superior, Accountant, Rami, Maya, Wasfi). The real
Aleppo accounts (Fouad and Salim, 493 rows, the file of 30 October) are no longer in that folder, so I could not repeat them; **the first
rehearsal below covered them and passed** (they are at update 35, the longest jump). If the real Aleppo is now on the server under another name,
please give me its file. There is still **no Jaramana database**.

### Who can do what, before and after (newest files)
"Same" = exactly the same rights. "More" = the same plus new rights. **Less: nobody.**

| Database | Person | Today (old profile) | After: role | Rights | Doors before → after |
|---|---|---|---|---|---|
| **Homs** | Fouad | Superior | **Administrator** | more (+13: the whole calendar with prices, inventory values and the inventory **big totals**) | Accounts, Administration → **+ Calendar** |
| | Assem | Accountant | Accountant | **same** | Accounts |
| | Roula · Nagham · Darine | Book holder | Book holder | same | Accounts |
| | Canzali (switched off) | Book holder | Book holder | same | — |
| | **Ghassan** (new since the first rehearsal) | "Reception" (a profile made by hand, one tick: *sees the calendar*) | stays **Custom** (still named Reception) | more (+1: the calendar tick of the new calendar; still no prices) | none → **Calendar** |
| **Al-Ard** | Fouad | Superior | **Administrator** | more (+13) | Accounts, Inventory, Administration → **+ Calendar** |
| | "Accountant" (placeholder) | Accountant | Accountant | more (+2: calendar, inventory values) | + Calendar |
| **HR** | Fouad | HR keeper | stays **Custom** | more (+11 calendar ticks, not used there) | as before |
| **Community** | Superior (Mourad), Econome (Fouad), Minister (Fouad) | the three office profiles | stay **Custom** | same | Accounts |
| | Administrator (Fouad) | community "Administrator" | stays **Custom** | more (+11 calendar ticks, not used there) | Administration → + Calendar |
| | Mourad · Fouad · Gerald · Julian | Jesuit | stay **Custom** | same | Accounts |
| **Country** | Alvaro Dorantes | Country econome | stays **Custom** | more (+11 calendar ticks, not used there) | + Calendar |
| **Province** (older file) | Coordinator / Province | Superior / Accountant | Administrator / Accountant | more (+17 / +6) | + Calendar |

The inventory **big totals** are a new right and only the Administrator role has it. Nobody lost anything because of it.
**Custom roles that carry donors or the Respo book: none.** Only the Administrator role carries them: **Fouad** on Homs and Al-Ard, "Coordinator" on
Province (and "Superior" in the Demo-named Aleppo file).

### New in the real data
- **Homs:** **no calendar spaces, no bookings and no inventory items yet.** Homs has 814 register rows (800 before), one inventory source (a budget
  heading marked as a source of purchases), and nothing else typed in the calendar or inventory. The first test on Homs will therefore start empty.
- **Al-Ard:** the calendar spaces you typed are there and **kept**: 2 buildings, 4 rooms, 1 booking, 2 allocations, 1 line, and 4 inventory places;
  no inventory items, no register rows. The update only adds the new lists around them.
- **Names in the centres and in HR:** the HR database still has **one** account, **Fouad**, spelled the same as in Homs, Al-Ard and the community.
  Nobody else has an HR account (Assem, Roula, Nagham, Darine, Canzali, Ghassan), so they have no HR door, as today. Nothing differs, nothing to merge.
  **Julian** is still only in the community database and has no account in Homs; **Alvaro Dorantes** only in the country database. The decisions
  of section 4 below are unchanged.
- **Assem (Homs Accountant)** gets nothing new: his profile on the real Homs server has none of the calendar ticks the other accountants have, so nothing is added: he keeps just what he had
  (no calendar, no calendar prices; the Al-Ard accountant does get the calendar). The question of the Accountants' prices (section 4) therefore
  concerns Al-Ard and the Province only.
- **Ghassan** is the one new person: his profile "Reception" is *not* the new ready-made Reception role (that one also has contacts, outside bookings and
  organisations). ☐ Keep him as he is, or give him the ready-made Reception role (more than he has now)?

---

## First rehearsal (24 November 2026), on the files of 22 November

Made on 24 November 2026 (job J5, "final check"). For Fouad. Plain words. **Nothing real was touched**: I copied the files, worked only on the copies
(in a private scratch folder, not shared, not in the cloud, not in `test-servers/`), and deleted them at the end. I checked that the real files are
byte for byte the same as before. No installer, no tag.

## In one minute

- **All the updates worked** on every copy: no error, no data lost, the database check says "ok" before and after, and a second run changes nothing.
- **Nobody loses any right.** Every person keeps everything they had. Some people get *more* (the new calendar and inventory rights). The number
  of people who get *less* is **zero**.
- The old **Superior** becomes **Administrator** with the same rights (plus the new ones). The old **Accountant** and **Book holder** become the
  ready-made roles with their own rights. Nobody is locked out.
- **Three things are for you to decide** (section 4): who is Administrator or Director on each database; whether the Accountants should see calendar
  prices; and a few small points listed in section 6.
- **One thing is missing:** there is **no Jaramana database** among the real files (see section 1).

## 1. What I tested

The updates are numbered. The last real version (0.12.1) was at update 63 at most; the new program goes up to **77** (calendar, inventory, roles).
I took the newest copy of each real database and ran the program's own update code on it (not a copy of the code: the same function the server
runs when it opens a database), then ran it a second time.

| Copy (real file it came from) | What it is | Update before → after | Time |
|---|---|---|---|
| `real-db/MAGIS/dbs/magis-homs` | **MAGIS Homs** (centre), taken 22 Nov | 57 → 77 | 51 ms |
| `real-db/aleppo/magis-aleppo_2026-10-30` | **MAGIS Aleppo**, the imported accounts (493 rows) | 35 → 77 | 78 ms |
| `real-db/aleppo/magis-aleppo_new-2026-11` | **MAGIS Aleppo**, the new file (budget of 63 lines, no rows yet) | 35 → 77 | 75 ms |
| `Al-Ard/MAGIS-Al-Ard.db` | **MAGIS Al-Ard** (centre) | 63 → 77 | 37 ms |
| `real-db/MAGIS/dbs/hr-sj` | **HR** | 57 → 77 | 48 ms |
| `real-db/MAGIS/dbs/homs-st-francois-regis` | a **community** (Homs, St François Régis) | 57 → 77 | 47 ms |
| `real-db/MAGIS/dbs/syria` | the **country** (Syria) | 57 → 77 | 45 ms |
| `real-db/MAGIS/province` | the **Province** account | 57 → 77 | 46 ms |
| `real-db/MAGIS/dbs/demo` | the **demo** database on the server | 57 → 77 | 46 ms |

**Jaramana:** I found no Jaramana database anywhere in the project (not in `real-db`, not in the other folders). If it exists on the Jaramana
server, it has to be rehearsed too, on a copy of its latest backup, before the build.
**Aleppo:** the Aleppo files are from 30 October (update 35), so they make the longest jump (42 updates); they passed too.
**Age of the copies:** the Homs files are from 22 November. The real server has moved on since: before the real build, repeat the rehearsal on the
newest backups (the script is ready, section 7).

## 2. Did anything get lost? (safety)

| Check | Result |
|---|---|
| An update failed | **No** (9 copies, 0 errors) |
| Database integrity ("ok") before / after | **ok / ok** on all 9; no broken link between tables before or after |
| Second run (must change nothing) | **Nothing changed** on all 9 (0 updates applied, every table identical) |
| A table with fewer rows after | **None.** Homs: 800 register rows → 800, 10 books → 10, 527 audit lines → 527, 6 people → 6. Aleppo (Oct 30): 493 → 493. Demo: 26 → 26. All the others: same counts |
| A value changed in an old table (compared cell by cell) | **No**, except the three expected cases below |
| Time | under 0.1 second per database |

The three expected cases: (a) the list of **roles** (`access_profile`) is updated: that is the purpose; (b) on **Aleppo**, an old update (before 77)
takes the column "account" out of the budget lines (all 63 lines had the same value; the 63 lines are all still there); (c) on **Al-Ard**, the
space kind "Other" moves to the end of the list (sort order 6 → 99), and six new space kinds are added.

## 3. Who can do what, before and after

How to read it: **same** = exactly the same rights; **more** = the same plus new rights the new version brings (calendar, inventory values, …);
**less** = something taken away. **Less appears nowhere.** "Doors" are the big badges of the new page (Accounts, Calendar, Inventory, Administration;
HR depends on having an account in the HR database).

### MAGIS Homs
| Person | Today (old profile) | After: role | Rights | Doors before → after |
|---|---|---|---|---|
| Fouad | Superior | **Administrator** | more (+16: the whole calendar with prices, inventory values) | Accounts, Inventory, Administration → **+ Calendar** |
| Assem | Accountant | **Accountant** | more (+6: sees the calendar and its prices, inventory values) | Accounts, Inventory → **+ Calendar** |
| Roula | Book holder | Book holder | same | Accounts |
| Nagham | Book holder | Book holder | same | Accounts |
| Darine | Book holder | Book holder | same | Accounts |
| Canzali (switched off) | Book holder | Book holder | same | (switched off) |

### MAGIS Aleppo (both files give the same result)
| Person | Today | After: role | Rights | Doors before → after |
|---|---|---|---|---|
| Fouad | Superior | **Administrator** | more (+20: the Respo book, the calendar, the inventory, downloads) | Accounts, Administration → **+ Calendar, Inventory** |
| Salim | Accountant | **Accountant** | more (+9: keeps the inventory, sees the calendar and its prices, values) | Accounts → **+ Calendar, Inventory** |

### MAGIS Al-Ard
| Person | Today | After: role | Rights | Doors before → after |
|---|---|---|---|---|
| Fouad | Superior | **Administrator** | more (+12: the whole calendar, inventory values) | Accounts, Inventory, Administration → **+ Calendar** |
| "Accountant" (placeholder name) | Accountant | **Accountant** | more (+2: calendar, inventory values) | Accounts, Inventory → **+ Calendar** |

### Province (copy of the Province account)
| Person | Today | After: role | Rights | Doors |
|---|---|---|---|---|
| Coordinator | Superior | **Administrator** | more (+16) | Accounts, Administration → + Calendar |
| Province | Accountant | **Accountant** | more (+6) | Accounts → + Calendar |

### Demo database (on the server)
| Person | Today | After: role | Rights |
|---|---|---|---|
| Superior | Superior | Administrator | more (+16) |
| Accountant | Accountant | Accountant | more (+6) |
| Rami, Maya | Book holder | Book holder | same |

### The databases where roles do **not** change (HR, community, country)
Update 77 deliberately leaves these alone: their people keep their **old profile as it is**, shown as **"Custom"**.

| Database | Person | Old profile (stays) | Rights |
|---|---|---|---|
| HR | Fouad | HR keeper | Custom, more (+11 calendar ticks, see section 6) |
| Community Homs St François Régis | Superior (Mourad) · Econome (Fouad) · Minister (Fouad) | the three office profiles | Custom, same |
| | Administrator (Fouad) | "Administrator" (a community profile, not the new role) | Custom, more (+11 calendar ticks) |
| | Mourad · Fouad · Gerald · Julian | Jesuit | Custom, same |
| Country (Syria) | Alvaro Dorantes | Country econome | Custom, more (+11 calendar ticks) |

**Custom roles in the five centre-type databases (Homs, Aleppo, Al-Ard, Province, Demo): none.** Every person there fits a ready-made role.

## 4. To decide by Fouad

Fouad's rule: Fouad is the main Administrator everywhere; second Administrators: **Alvaro for Jaramana, Julian for Homs and Aleppo**; whoever is
only the centre's boss becomes **Director**. This is what the real data shows today. Nothing below was changed: it is for you to say.

| Database | Today's Superior | After the update | **Your decision** |
|---|---|---|---|
| **Homs** | Fouad | Administrator | ☐ Fouad stays Administrator (as you said). ☐ **Julian** has **no account** in the Homs centre: add him as second Administrator? ☐ Is there a centre boss to make **Director**? (nobody is Superior-only today) |
| **Aleppo** | Fouad | Administrator | ☐ Fouad stays Administrator. ☐ **Julian** has no account here: add him as second Administrator? ☐ Director for the centre's boss? (no one named in the file) |
| **Al-Ard** | Fouad | Administrator | ☐ Fouad stays Administrator. ☐ A second Administrator or a Director? (no one named) |
| **Jaramana** | — | **no database found** | ☐ **Alvaro** as second Administrator once the database exists; Director for the centre's boss |
| Province | "Coordinator" (a placeholder name) | Administrator | ☐ Who is this person really? Keep as Administrator? |
| Demo | "Superior" | Administrator | ☐ Nothing to decide (demo) |

- The update itself never makes a Director: it only turns the old Superior into Administrator. **Fouad (as Administrator) adds** the second
  Administrators and the Directors afterwards, in *Administration → People* (only the Administrator can give these two roles; nobody gives a role to
  himself; at least one Administrator always stays).
- **If you ever turn an Administrator into a Director**, that person loses: writing in the books, the Main book and closing months, the lists, the
  budget changes, backups/exports/imports, keeping the inventory (the Director *looks* at it, with its values), and the donors and the Respo book.
  He keeps the whole new calendar. I
  worked it out for each Administrator in the copies; it is the same list everywhere.
- **Accountants** (Assem, Salim, the Al-Ard accountant, Province): they now see the calendar **with its prices** and the inventory values, because
  earlier updates gave the old Accountant the calendar-keeping ticks. The ready-made Accountant role is *calendar view only, no prices*. ☐ Keep as
  it is (nobody loses anything), or reduce the Accountants on the Roles page after the update?

## 5. Who would see donors and the Respo book

Only roles of kind **Administrator** carry the donors, grants and the Respo book:

| Database | Who sees them after the update |
|---|---|
| Homs | **Fouad** |
| Aleppo | **Fouad** |
| Al-Ard | **Fouad** |
| Province | "Coordinator" |
| Demo | "Superior" |
| HR, community, country | nobody (these databases have no such role) |

**Custom roles that still carry donors or the Respo book: none** in any of the copies. Accountants and Book holders do not have them. (The notice
"old roles" that step 2 adds to the People page will therefore stay empty on these data.)
On Aleppo, the old Superior did not yet have the Respo-book tick; the Administrator now has it (more, never less).

## 6. Names, and small points to look at

**Names in the centres and in HR.** The real HR database has **one** account: **Fouad**, spelled the same as in Homs, Aleppo, Al-Ard and the
community: nothing differs. Nobody else has an HR account, so Assem, Salim, Roula, Nagham, Darine and Canzali have **no HR door** (as today).
In the community database the office accounts are named "Econome (Fouad)", "Minister (Fouad)", "Administrator (Fouad)", "Superior (Mourad)": these
are offices, not people, and stay as they are. **Julian** exists only in the community database; **Alvaro Dorantes** only in the country database;
the placeholders ("Accountant" on Al-Ard, "Superior" on demo, "Coordinator" and "Province" on the Province account) have no real name yet.
**"To check" list:** none to merge; only the placeholders above need real names.

**Problems found: none that blocks.** Small points, none loses a right:
1. **Province** is treated as a centre by update 77 (it excludes only HR, communities and the country): its Superior became "Administrator". The
   rights are identical to before, so this is harmless; say if the Province should rather stay as it was.
2. **HR, community and country:** their manager profile (the one that manages users) receives the **11 calendar ticks** too (an old update gives
   them to every profile that manages users). Harmless, they have no calendar, but a "Calendar" door could appear for them. Worth a look at the
   first test.
3. The **Administrator** role keeps the exact ticks of the old Superior, so it does not list three small ticks the ready-made list has
   (`register.main`, `users.holders`, `users.passwords`); the program already allows what they allow through the Administrator's other ticks. It
   also keeps two old ticks (coverage, funds reports). Nothing to do.
4. This rehearsal checks the **databases and the rights**. It does not open the server, the screens or the phone app; that is for the last test.

## 7. How to run it again (on a fresh copy)

The script `scripts/rehearse-roles.ts` opens a **folder of copies**, runs the updates twice, prints before/after for every person and writes the
details to a JSON file (names, roles, ticks: never a password). It refuses a folder inside `real-db/` or `test-servers/`.

```bash
node_modules/.bin/esbuild scripts/rehearse-roles.ts --bundle --platform=node --format=esm --outfile=SCRATCH/rehearse-roles.mjs
node --no-warnings SCRATCH/rehearse-roles.mjs SCRATCH/copies SCRATCH/result.json
```

(`SCRATCH` is any private folder outside the project; put copies of the `.db` files in `SCRATCH/copies`; delete the folder afterwards, it holds real
data.) Run on the working tree of 24 November 2026 (migrations committed up to update 77). This report names real colleagues: keep it off shared
folders and clouds.

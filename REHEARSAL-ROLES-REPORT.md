# Rehearsal of the updates 57 → 77 on copies of the real databases — who can do what, before and after

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

# MAGIS Calendar — decisions and plan (written 22 November 2026, nothing built yet)

> **Superseded on 23 November by `CALENDAR-BASELINE.md`** (the concept with Fouad's answers and the new step list).
> This file is kept as the history of the first decisions.

Drawings: `calendar-mockups.html` (same folder). Examples only.

## Decisions of Fouad (22 November 2026)
1. **One calendar** for the programme (workshops, courses, clubs, Study Zone, trainings) and for the bookings (halls, stays, kitchens).
2. It lives **inside MAGIS** (the program with the centre's database). Later, the centres' databases are gathered on one server by synchronised copies (see `IDEA-WEB-APP-AND-CENTRAL-SERVER-2026-11-22.md`). The website's Laravel calendar is replaced, not kept beside it.
3. **No viewing from outside the centre.** But the phone must keep the **view of its last connection**, and show the calendar **without signing in**. Two views: a **phone** view and a more developed **laptop** view (the centres use laptops).
4. **Roles**, several, chosen by the Superior. **No approval step** (nobody asks, nobody confirms: whoever has the right, does it).
5. Fouad will give the **list of areas, rooms, kinds and beds** (Homs first).
6. **Automatic lists "to prepare" and "to clean"** for the cleaner and the kitchen: wanted.
7. Language: Arabic or Arabic + English = right-to-left; English or French only = left-to-right, Monday first.

8. (23 November) The plan is agreed. The Today strip counts **rooms free**, not beds free (beds stay in the data, the headline is rooms).
9. Once all the answers of `calendar-questions.html` are in, a baseline file with the whole concept is written before any code.

## What already exists (so we do not start from zero)
- Spaces: areas (`host_building`, with a colour), rooms (`host_room`), kinds of room with beds or capacity (`host_kind`).
- Bookings (stay or event), statuses, weekly repeat with hours, conflicts counted by hours, equipment asked and checked against the inventory, services, payments as suggestions, receipts, reports/Excel.
- Offline phone calendar (Day/Week/Month) inside the full phone app; ticks `hosting.view/book/prices/keep`.
- Missing: activity kinds with colours (workshop, course, club…), changing or cancelling ONE date of a repeating activity, a leader per activity, calendar-only phones without sign-in, the "Today" view, views saved per person, the lists to prepare/clean, the board redesign.

## Plan (each step is tested in the side pane and committed; no installer until Fouad says "build")
| # | Step | Result |
|---|------|--------|
| 0 | His lists (areas, rooms, kinds, beds, weekend, roles, activity kinds) | the real Homs spaces typed in once |
| 1 | Foundation: kinds of activity with colour, leader, "private" tick, one date of a repeat changed/cancelled, new rights, spaces loaded from his list | data ready, tests |
| 2 | Laptop screen: slim bar, saved views, Today strip, week board with bars, month with bars, grouped list, language direction | the new look |
| 3 | Programme screens: add a workshop/course/club (weekly), change this or the following dates, cancel one date | replaces the website calendar's editing |
| 4 | Calendar phone: a manager adds a phone, no sign-in, own icon, opens on Today, last view kept and dated, read-only, can be cut off | phone view |
| 5 | Lists "to prepare / to clean" (from the bookings and the programme) on phone and laptop | for the cleaner and the kitchen |
| 6 | Door and roles: a "Calendar" door, ready-made roles, guide, checklist | usable by everyone |
| 7 | Only if wanted: one-off import of the website's calendar (Damascus, Homs, Aleppo) on copies | history and future sessions kept |

Order reason: the laptop board and the roles come first because the managers use them daily; the phone follows; the import is last because it touches other centres' data.

# First test: the new Calendar and the new Inventory (24 November 2026)

**Where:** a COPY of your real data (`test-servers/next-test`, made from `real-db/MAGIS`, without the keys). The real server
is never touched. Double-click `test-servers/START-NEXT-TEST.command` → `http://localhost:8193`, or use the side pane
(it is already running there). **Every account has the password `test123`.** Sign in as Fouad, open MAGIS Homs.

**Checked before you:** all 335 tests pass; the database updates (57 → 71) were run on copies of your six real databases:
nothing lost, nothing broken, a second run changes nothing.

**Two things to know before starting**
- Homs has no calendar spaces yet (the 0.12 calendar was never used), and its inventory is empty. So the test starts by
  **typing a few areas and spaces** — this is also the first real use.
- The menu still has the **old** pages ("Calendar · الإقامة والتقويم" and "Inventory · الجرد") beside the **new** ones
  ("**New calendar**" and "**New inventory**"). Test the **new** ones. The old ones disappear, and the separate doors come,
  in the last steps.

---

## A. Calendar → Settings (button at the top right of "New calendar")
1. **Areas**: add two or three (e.g. Main building, Guest house) with a colour.
2. **Spaces**: add halls (capacity), bedrooms (beds), a kitchen; untick **"Can be booked"** for a store: it shows
   "Inventory only" and never appears in the calendar.
3. **Lists**: kinds of activity, kinds of organisation, **services**, **equipment**.
4. A **closed period** (e.g. August) and a **space closed for repairs** for a few days.

## B. Calendar → the screen
5. Week, Day, Month, List; the quick views **Everything / Halls / Rooms**; the area list; **search**.
6. **Drag** over hours (Day) or days (Week, Month), over one or several spaces → the booking window opens already filled.
7. The **Today strip**: click each tile.

## C. Calendar → the booking window
8. **Our activity** every week (e.g. a course Mon and Wed 17–19) → saved; then another one at the same place and time →
   **refused**. A weekly one where some dates are taken → offered **without those dates** (listed).
9. **Outside booking** for an organisation: create one with **two persons** (✎ / ＋), choose the person.
10. **Price**: the **"free"** tick (ticked at first); untick → amount, USD/SYP, per person per night / whole / each date;
    add a **service** and **equipment** (more than the inventory has → a warning). Save, reopen: the total is there.
11. **"To confirm"** with the date the space is held until.
12. Sunday, the closed period, more people than the capacity → **warnings**; the space closed for repairs → **refused**.
13. Bar → **Organisations**: the register; search by name, person or phone.

## D. Inventory → New inventory
14. The **map** (first page): areas with a card per space; the old stores are in **"Inventory places · أماكن الجرد"**.
15. The figures on top; **purchases to register** (Homs has 9): register one or two as items.
16. Add a few items (one alone, one group like Chairs ×40) in a space; give a **photo** to one.
17. **A space page**: photos, list, **Count this space**, **Move items** (move 15 of the 40 chairs → the group splits,
    -A here and -B there).
18. **An item page**: details, history, the links to the purchase and to the calendar.
19. Quick views: by place, by category, all items, **with staff** (give a laptop to a staff member).
20. Categories (old Inventory → Settings): the ticks **serial / valuable / shown in the calendar**.

## E. Together
21. An item whose category is "shown in the calendar" (e.g. a projector in Hall 1) → in the calendar, Hall 1 shows it as
    **"always in the room"**.
22. In the booking window, the **equipment** list comes from the inventory.

## F. Nothing else broke
23. Register, Cash, Budget, Reports, Grants: open them, they show the same as before.

## Not in this test (later steps)
Payments and the receipt improvements, printed pages, the calendar phone, "To prepare today", the TV, the reports by
organisation, the donor report, problems reported, the separate doors and the ready-made roles.

**Your comments:** write them in our conversation, as they come (a screenshot helps). Nothing is built until you say "build".

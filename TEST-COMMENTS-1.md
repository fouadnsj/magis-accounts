# First test — Fouad's comments (collected, sent to the sessions together)

## Calendar
1. **A kind may have "No category"** (decided A, 23 November 2026). The kind window today forces a category. Add a
   choice "No category (not in the calendar)". Kinds without a category (Store, Office, Storage room…) never appear in
   the quick views (Halls / Rooms…). Fouad: "I don't want the stores to appear in the calendar categories."
   Confirmed with it (inventory comment 3): a starting kind "Store · مستودع" with no category in every centre (if a kind
   named Store / مستودع already exists, e.g. typed in the test copy, use it and take away its category).
2. **The booking view (the window that opens on a click) must be clearer, better ordered, readable in one look**
   (Fouad, 23 November 2026, screenshot: "نادي حمص السنمائي · مهرجان سينما"). Today: tags in a loose row, a plain
   list When/Where/Organisation/Person/People, then the buttons for the clicked date mixed with the others. Proposed
   (Fouad will see it in the next test; no drawing first): a coloured head with the name and the state; one block of big facts (dates and
   hours, the space(s), people); one block "who" (organisation, person, phone to call); one block money (free or
   price, paid, left) and services/equipment; the buttons at the bottom in two clear groups: the whole booking
   (Change, Cancel the booking) and "only this date (Wed 25)" (Move, Cancel this date, this date and the following).
3. **"Organisations" beside "New"** (Fouad asked why it is there). It opens the register of organisations (baseline:
   managed by the Director, Coordinator, Reception). Decided (B): **it stays in the bar, but away from "New", at the end of the bar**.
4. **Going from the calendar to Settings and back is not visible enough** (Fouad, 23 November 2026). Proposed: in
   Settings, a clear button at the top "← Back to the calendar · رجوع إلى التقويم" (and the page title "Calendar ›
   Settings"), and the Settings button on the calendar easy to see (same place, with its icon). Same for the inventory
   (its Settings ↔ map) if it has the same problem.

## Inventory
1. **A fast way to enter the inventory room by room, with a preset list** (Fouad, 23 November 2026). Fouad: "you
   already built this in the Quick add of the old inventory; use the same, with some improvement if suitable."
   Reuse `QuickAdd` (src/ui/Inventory.tsx: table, Enter = next row, common names COMMON_ITEMS, origin, Excel template,
   blank labels) and bring it into the new inventory:
   - a button **"Quick add"** on each **space page**: the space is already chosen (no Place column);
   - also from the map home, with the space chosen per row, as today;
   - improvement — **a ready list per kind of space**: the table opens with the usual items of that kind already in
     rows (quantity empty); the keeper types the numbers and saves once; rows left at 0 are skipped. The ready lists are
     edited in Settings (per kind); they start from the common names, put by kind (Bedroom: Bed, Cupboard…; Hall: Chair,
     Table, Whiteboard…), and the centre changes them;
   - the category ticks apply: "valuable" → asks for a photo/label later (flag the row), "serial" → the serial box shown.
2. **The serial number only where it is needed** (Fouad, 23 November 2026, seen in "Register a purchase in the
   inventory" for a kitchen item, حافظات طعام): the field "Serial number (one row per laptop)" shows for every item.
   It should show, **highlighted**, only when the chosen category has the tick "serial number" (IT, Audio-visual); for
   the other categories, no serial box (or a plain, small one). Same rule in the New item window and in Quick add
   (`src/ui/Inventory.tsx` ~line 409; the New item window already does it at line 231).
3. **A quick view "Stores · المستودعات"** beside Map / By place / By category / All items / With staff (Fouad, 23
   November 2026: "it will be helpful"). It shows the map with only the store spaces and what is in them. Decided (A):
   **only the spaces whose kind is "Store"**. So the starting kind "Store · مستودع" (no category, calendar comment 1) is
   needed in every centre; the view finds it by that kind.
4. **The person who has an item (a laptop…) comes from the HR system** (Fouad, 23 November 2026: "must come from the
   hr system"). Today "With staff" is a typed name (`inv_item.holder`, free text). Baseline §3 and step 3 already say
   so: the person is chosen from the people of the centre in MAGIS HR (typed only if not there), and the keeper is
   reminded when that person leaves. Do it with these fixes, or first thing in inventory step 3.

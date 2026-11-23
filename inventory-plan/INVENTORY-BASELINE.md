# MAGIS Inventory — the concept (BASELINE 1.1 — FINAL, 24 November 2026)

Made from Fouad's two rounds of answers (`inventory-questions.html`, `inventory-questions-2.html`, pasted 24 November).
Every point is decided (the last one on 24 November, §10). Nothing is built yet: building starts when Fouad says so.
Drawings: `inventory-mockups.html` (examples only) · summary: `INVENTORY-SUMMARY.html`. The inventory of today:
`src/inventory/` (migrations 55–57). It goes with the new calendar: `calendar-plan/CALENDAR-BASELINE.md`.

---

## 1. Why, and the rules
The finance follows the assets: what the centre buys with its money (and what it is given) must be known — **what we
own, where it is, in what state, and what it is worth** — in a way that is **more visual and more practical** than today.

1. **Its own section**, like the calendar: a door "**Inventory · الجرد · Inventaire**" in MAGIS, in the **same database as
   the centre**, linked to the books and to the calendar.
2. **One map of the centre, kept once**: the calendar's **areas and spaces**. Each space has a tick **"can be booked"**:
   a space that cannot be booked (store, office, storage room) is shown **only in the inventory**, never in the calendar.
   The 0.12 places of the inventory are carried into the map without loss.
3. **Every purchase on a furniture or equipment line** is listed as an item, or marked "not an item" (as today).
4. **Value** = the purchase's value in USD, or an estimate (gift, old). **No depreciation.**
5. **Nothing is deleted**: an item given away, sold or thrown is **taken out with a reason**, no money (as today).
6. **Small things are not listed one by one**: only as a group ("Mugs ×40"), or not at all.
7. **Things that are used up** (paper, cleaning products, kitchen supplies) are **not** in the inventory, only in the books.
   A **stock** (مخازن) for materials and for the farm will be a separate work, later.
8. **The 0.12 inventory screens are not used** in the centres meanwhile: Fouad waits for the new ones.

## 2. Who does what
| Right | Keeper | Director | Coordinator | Given by tick | Everyone |
|---|:-:|:-:|:-:|:-:|:-:|
| Look at the inventory (map, spaces, items) | ✔ | ✔ | ✔ | ✔ | |
| See the values ($) | ✔ | ✔ | | | |
| Add, **move**, count, take out, set the state, give to a staff member | ✔ | | | | |
| Report a problem (laptop or full phone app) | ✔ | ✔ | ✔ | ✔ | ✔ |

- The **keeper** is the accountant, or a person given the task (store keeper). Both may exist. Only the keeper moves items.
- The right to **look** can be given to other persons as a **normal tick**, taken back by hand.
- The values are seen by the Director and the keeper (the accountant is a keeper).
- The roles are ticks the Superior can change, like the other roles of MAGIS.

## 3. What the inventory holds
**Items**: label (QR), name, **category**, space, quantity (one object or a group), brand, model, serial number, state
(**good / to repair / broken**), origin (bought, gift, old… an editable list), purchase entry and supplier, value,
photos, note, and the **history** (bought, moved, given to a staff member, state changed, counted, taken out).

**Categories** (an editable list, as today) each have three ticks:
- **serial number** expected (IT, audio-visual), as today;
- **valuable**: a **photo and a label are asked** for its items;
- **shown in the calendar**: its items appear in the calendar as "**always in the room**" (projector, sound, air conditioner…).

**A group of objects** (Chairs ×60): when some move to another space, the group is **split** — Chairs ×30 here, ×30 there,
the same label with a letter (HO-0102-A, HO-0102-B).

**With a staff member** (usually laptops, once a year or more): the person is chosen from **the people of the centre (the
HR list)**, or typed if not there; the item shows who has it and since when. No page to sign. **When a staff member
leaves** (in MAGIS HR), the keeper is **reminded** of what they still have. No other lending is followed.

**Problems reported**: the person **writes what and where, with a photo** (they do not look at the inventory); it goes to
the keeper's list; the keeper sets the state of the item (or "nothing wrong"); the person then sees **"seen by the
keeper"** and the new state. From the laptop and the full phone app only (not the calendar phones). **Kept very simple**: one button, what, where,
a photo (§10).

## 4. The screens
1. **Home = the map of the centre**: areas, a card per space (photo, how many items, value for those who may see it,
   last count, what needs attention). Figures on top: items, value, **purchases to register**, **to repair or broken**,
   **with staff**, **problems reported**. Quick views: by place · by category · all items · with staff.
2. **A space**: the photos of what is in it, then the list; buttons Count this space, Move items, **Sheet for the door**.
3. **An item**: photo, details, the **history**, the links to the **books** (purchase entry, bill, supplier, project) and to
   the **calendar** (the bookings that asked for it).
4. **To register**: the purchases on furniture or equipment lines waiting to become items (as today, with the bill).
5. **Photos** are shown in the lists and on the space pages.

## 5. With the books
- A purchase on a furniture or equipment line → item(s), or "not an item" (as today).
- **What a project bought** — a report for the donors: **the items bought on the budget lines funded by that project, in
  the chosen period**, with photos, spaces and values: a **PDF with photos** for the donor, and an **Excel**.
- Repairs stay a state only: no cost is linked to the item.

## 6. With the calendar
- The **same areas and spaces**; a space that cannot be booked is not in the calendar.
- "**Always in the room**" in the calendar is **read from the inventory**: the items of that space whose category is ticked
  "shown in the calendar". (Calendar step 1 keeps it as a typed text; it is replaced when the two are joined.)
- The equipment asked by a booking is counted from the inventory: **only a warning**, as today.

## 7. On the phone (the full MAGIS phone app)
- **Report a problem** (what, where, a photo).
- **Count** with the labels, when the keeper wants (as today).
- **Record items** (as today).

## 8. Printed
- **The sheet of a space** (to put on its door): what is in it.
- **Labels (QR)**, as today.
- **A list for counting**, space by space.

## 9. Steps (each tested in the side pane and committed; no installer until Fouad says "build")
| # | Step |
|---|---|
| 1 | One map: the inventory's places joined with the calendar's areas and spaces; the "can be booked" tick; categories with their three ticks; groups that split; "always in the room" read from the inventory |
| 2 | The new screens: map home, space page, item page (photos, history, links), quick views |
| 3 | With a staff member (HR list, reminder when someone leaves); problems reported (laptop and phone) |
| 4 | Printed pages (space sheet, counting list) and the donor report by project (PDF with photos, Excel) |
| 5 | Door, roles, guide, checklist |
| — | Later: the stock (مخازن) for materials and the farm · all the centres on the central server, with a filter by centre |

Step 1 comes after the calendar's step 2 or alongside it, since both use the same areas and spaces.

## 10. The last point (decided 24 November 2026: "Keep it simple")
**Reporting a problem** stays, **very simple**: one button "Report a problem" (laptop and full phone app) — what is wrong,
where, a photo. Nothing else to fill in. It goes to the keeper's list; the person sees "seen by the keeper" and the new state.

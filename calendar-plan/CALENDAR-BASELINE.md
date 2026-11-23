# MAGIS Calendar — the concept (BASELINE 2.1 — FINAL, 24 November 2026)

The complete concept, made from Fouad's decisions of 22 November and his four rounds of answers
(`calendar-questions.html`, `calendar-questions-2.html`, the walk-through's round 3, `calendar-questions-4.html`).
Every point is decided (the last three accepted on 24 November, §11). Nothing is built yet: building starts when Fouad says so.

Files in this folder: summary `CALENDAR-SUMMARY.html` · clickable model `calendar-model.html` · a week in Homs
`calendar-walkthrough.html` · first drawings `calendar-mockups.html` (the Excel `MAGIS-Calendar-spaces.xlsx` is no longer used, §12).

---

## 1. Why, and the golden rules
The calendar is the tool everybody in a centre looks at, from the director to the people who prepare the halls. It must
say at a glance **what happens today, where, and what is free**, on the laptop, on the phone and on a screen at the
entrance, even without connection.

1. **One calendar** for our own activities and for the bookings of others (halls, guest stays, kitchens).
2. **A space is never given twice.** If something already holds a space at that time, the second one **cannot be saved**,
   whichever it is. An outside booking already agreed is **never moved**. Our activities come first because we put them
   in first (that is why they repeat every week).
3. **"To confirm" already holds the space**, until a date written in the booking (7 days by default); after it the
   program shows it in red; it never frees the space by itself.
4. **Looking is for everyone; changing is for a few.** No approval step: whoever has the right does it.
5. **Only inside the centre.** Nothing open on the internet. The phone keeps the view of its last connection.
6. **Simple words.** We "prepare" a hall or a room; there is no "cleaner" role and no "to clean" list.
7. **Nothing is deleted.** A booking or a date is cancelled with a reason and kept. Every change is kept (who, when,
   what); the Director sees this history.
8. **Lists stay editable in the program**: kinds and categories of space, kinds of activity, kinds of organisation, services.

## 2. Where it lives
- **Inside MAGIS**, in the database of each centre. Later the centres' databases are gathered on one server by
  synchronised copies; there, one view of all the centres together, **with a filter by centre, each centre's events in the
  colour of its logo**.
- The calendar of version 0.12.1 is **not used** in the centres meanwhile; its tables are the starting point.
- The website's calendar is replaced (§9).

## 3. Roles
| Right | Director | Coordinator | Reception | Team |
|---|:-:|:-:|:-:|:-:|
| See the calendar and "To prepare today" | ✔ | ✔ | ✔ | ✔ |
| See the contacts (person in charge, phone) | ✔ | ✔ | ✔ | |
| Add or change our programme | ✔ | ✔ | | |
| Add or change outside bookings | ✔ | ✔ | ✔ | |
| Add or change organisations and their persons | ✔ | ✔ | ✔ | |
| Mark guests arrived / left | ✔ | | ✔ | |
| Set prices and service amounts, the "free" tick | ✔ | ✔ | | |
| Record payments, decide what is kept when cancelled | ✔ | ✔ | | |
| Book the whole centre · close a space for repairs | ✔ | | | |
| Set up spaces and lists | ✔ | | | |
| See the history of changes | ✔ | | | |

- **One Coordinator role** (workshops and academic together), no limit by kind.
- **No accountant role**: the accountant sees the payments as suggestions in the books, as today.
- **Team** = everyone else who only looks, including the **leaders of activities who have no account** (a tutor, a
  volunteer): they may have a calendar phone as Team.
- The roles are ticks the Superior can change, like the other roles of MAGIS.

## 4. Three ways to see it
1. **Laptop**: a "Calendar · التقويم · Calendrier" door in MAGIS. Someone with only calendar rights sees only the calendar.
2. **Calendar phone**: linked once at the centre by a manager, who gives it a **name** and a **role** (Team, Reception,
   Coordinator, Director). Opens with a **short code** (4 digits), then straight on Today. No sign-in. **Read only.**
   Keeps **1 month back and 6 months ahead** and says when it was last updated. Never receives prices or payments;
   contacts (person and phone) only on Reception, Coordinator and Director phones. The manager can cut a phone off.
   (The full MAGIS phone app stays as it is.)
3. **TV at the entrance**, on **08:00–22:00**: today's activities and bookings by space and hour, with the names of the
   groups (private ones show "Reserved"), refreshing itself, in any browser. A first plain version; **its real design
   (logo, photos, gentle animation) is a work of its own, later**.

## 5. What the calendar holds
**Spaces.** Centre → **area** (building or part, with a colour) → **space**: name, kind, capacity (people) or beds
(bedroom), rentable or ours only, what is always in it, note.
- Kinds (editable): hall, classroom, meeting room, bedroom, kitchen, dining room, library, chapel, outdoor, office, other.
- **Categories** (the quick views): **Halls** (halls, classrooms, meeting rooms, library, kitchens, outdoor…) and **Rooms**
  (bedrooms). Other categories are added in Settings (for example **Playground**, with Football and Basketball inside).
- A **kitchen** is booked **by hours**, like a hall.
- **One group per bedroom**, even if beds are left; the program counts **rooms free**, not beds.
- **More people than a space holds**: a warning; saving stays possible.
- **A space closed for a while** (repairs, painting): closed from a date to a date with a reason; nothing can be booked there.
- Halls that join into one (a movable wall): not known yet → not in the first version; can be added later (§11).

**Our activities (the programme).** Kinds (editable, each with a colour): Workshop · ورشة, Course · دورة, Club · نادي,
Training · تدريب, Event · نشاط, Christian education · تعليم مسيحي, Prayer groups · فرق صلاة.
- Each activity: title, kind, **leader** (a name; not every leader is paid; the link with MAGIS HR comes later), one or
  several spaces, hours; once, several days in a row, or **every week on chosen days** between two dates.
- One date can be **moved or cancelled** (with a reason), or "this date and the following".
- **Activities outside the centre** (a trip, a camp at Al-Ard, a visit): on the calendar **without a space**, with the
  place written.
- **Study Zone is not an activity**: it is the library being open (it will matter for the check-in, later).

**Outside bookings.** A **hall booking** or a **guest stay** for an **organisation** or a person.
- Organisations are **registered once**: name, kind (editable: church, parish group, association, school, university,
  company, person, other), a **note**, **one or several persons in charge** with their phones. Each booking picks the
  organisation and **the person for this booking**; the phone comes by itself.
- One or **several spaces** in one booking (two classrooms for a conference).
- May **repeat every week** (a choir every Tuesday). A weekly booking where some dates are taken is **saved without those
  dates**, which are listed.
- Statuses: to confirm (held until a date, 7 days by default) → confirmed → arrived → left; or cancelled.
- **Stays have days, no hours** (arrives on…, leaves on…).
- A group that changes bedroom during its stay: cancel and make a new booking (no change of room in the middle).
- **No time is added** between two bookings: the hours typed include the preparing.

**Private tick.** A booking or activity marked private shows only "Reserved" on phones, on the TV and for the Team.

**The days.** Open 7 days. **Sunday**: a hall booked on Sunday gets a gentle warning; accommodation is always welcome.
**Closed periods** (holidays, usually August): a coloured band and a warning; booking stays possible.
**The whole centre** (festival, one big activity) is booked by the Director: every space is held; it cannot be saved
while anything else holds a space.

## 6. The booking window
Opened by **selecting on the calendar** (drag over hours in the day view, over days in the week or month view, over one or
several spaces) or by **+ New**; everything selected is already filled in. In this order:
1. **Who**: our activity (kind, title, leader) or outside booking (hall booking or guest stay; organisation from the
   register or added; the person in charge for this booking), number of people.
2. **Where**: one or several spaces, grouped by area (bedrooms only for a stay), or "outside the centre" for our activities.
3. **When**: one day, several days in a row, or every week on chosen days; hours from a list in 15-minute steps with quick
   choices (morning, afternoon, evening, the whole day). A stay: arrival and leaving days.
4. **Equipment needed** (projector, sound, chairs…) from the inventory with a quantity; a warning if bookings at the same
   time ask for more than the inventory holds.
5. **Services** (meals, coffee break, logistics, heating…): how many; their amounts are typed by the Director or the Coordinator.
6. **Price** (Director or Coordinator): a **"free" tick, ticked by default**; while it is ticked the whole price section is
   hidden and the report counts the booking as free use of our spaces. Untick it to give the amount and currency (USD or
   SYP), **per person per night** (stay), **for the whole booking** or **each date** (repeating). Every change of price is
   kept in the history. **Reception** does not see this section: its bookings are saved **"price not set"** (not free),
   and the Director or the Coordinator decides free or a price.
7. **Status** (to confirm with the date held, or confirmed), private tick, note.

The program checks: a space already held → not possible; Sunday, closed period, capacity, equipment → warnings.

## 7. Money and paper
- The side window of a booking shows the price, the **agreed total (price + services), received, still due**.
- **Record a payment** (Director or Coordinator): at any time, **even before confirming** (an advance is possible, never
  required). Each payment goes to the books as a suggestion for the accountant, with its receipt number.
- **Cancelled after money was received**: decided each time: **keep all, give all back, or keep a part** (the amount kept
  is typed). What is given back goes to the books as a suggestion.
- **The receipt (وصل استلام, never "invoice")** stays as built in 0.12: the two logos (the Jesuits' and the centre's),
  the Arabic title of the house, the lines adjustable before export, the currency choice with a rate, the **preview**
  before export, the totals in view. **Improvements (decided):** the amount **in words** (Arabic and English); a receipt
  **for each payment** with the same number as in the books, besides the receipt of the whole booking; places to **sign**
  ("received by" / "paid by"); a **"copy"** mark when printed again; the booking sheet for the group with the same look
  and the two logos, **without amounts** for free bookings.
- **Printed pages**: the week of one hall (to put on its door); a **short page for a day or a week** (for the reception or
  the guard); a booking's sheet for the group (dates, spaces, services); an Excel list of the bookings.

## 8. The screens
**Laptop.** One slim bar (‹ Today › · period · Day | Week | Month · area · **search** · + New). Quick views kept per
person: Everything, Halls, Rooms, and the categories added in Settings.
- **The Today strip**: arrive today · leave today · halls in use now · **rooms free tonight** · to confirm. Each tile
  **opens its list with its buttons** (mark arrived, mark left, book a free room, confirm; held dates passed in red).
- **Week**: stays as bars across the nights, hourly bookings as small blocks in each day, spaces grouped by area (an
  area can be folded), a line "outside the centre" when needed.
- **Day**: by hours **08:00–22:00**. **Month**: how busy each day is and **all the day's events in its box**.
- **List**: Upcoming / In the house / To confirm / Past.
- **Search**: names, organisations, leaders, phones (for those who may see them), spaces, notes; each result shows its
  next date and opens it.
- **Reminders** (held date passed, groups arriving tomorrow) are **optional**: each person switches them on or off
  (off at first). The red "date passed" in the lists always stays.
- Arabic (or Arabic + English): right-to-left. English or French: left-to-right. **The week starts on Monday in every
  language. Digits 0–9** everywhere (as in the website).

**Phone.** Today · Week · Spaces, and "To prepare today". Read only at first.

**"To prepare today"** (made by the program from the bookings, nobody types it; everybody sees it): halls and kitchens
before their first activity or booking (time, people, equipment); bedrooms for the groups arriving; bedrooms after a
group leaves (ready again). A "done" tick later.

**Reports.** As today, plus **by organisation** (how many bookings, days and hours, which spaces), **ours against
outside**, and **free use** of our spaces. Excel export.

## 9. Moving the website's calendar
Homs and Aleppo: future sessions **and** history, later, from a fresh export of the website (the copy here is old).
Done on copies first, with a list of what will change.

## 10. Steps (each tested in the side pane and committed; no installer until Fouad says "build")
| # | Step |
|---|---|
| 1 | Foundation (**built 23 November 2026**): areas, spaces and categories, kinds lists, ours / outside, organisations with several persons, leader, private tick, weekly repeat with one date moved or cancelled, the "never twice" rule, holds with a date, closed spaces, closed periods, whole centre, activities outside the centre, free tick, price history, new rights; the 0.12 test data carried over |
| 2 | Laptop screen: bar, quick views, search, Today strip with its lists, week, day, month, list; drag to book |
| 3 | The windows: activity, outside booking (price, services, equipment), organisation |
| 4 | Money and paper: payments (also before confirming), cancelling with a part kept, receipt improvements, printed pages, Excel |
| 5 | Calendar phone (name, role, short code, last view kept) |
| 6 | "To prepare today" (laptop, phone) |
| 7 | TV screen, plain version |
| 8 | Door, ready-made roles, reports by organisation and free use, optional reminders, guide, checklist |
| 9 | Later: moving the website's calendar · the TV's real design · the "done" tick · joined halls · the link with HR · all the centres on the central server |

## 11. The last points (decided 24 November 2026: "Yes, as suggested")
1. The "free" tick and Reception: Reception's bookings are saved "price not set" (§6).
2. Receipt improvements: all accepted (§7).
3. Halls that join into one: not in the first version; added later as "linked spaces" if a centre has a movable wall.
~~Still to come from Fouad: `MAGIS-Calendar-spaces.xlsx`~~ — replaced by §12.3.

## 12. Decided after step 1 (23 November 2026)
1. **Sunday warning**: only for an outside hall booking; our own activities and the guest stays never get it. (Yes.)
2. **Closing a space over bookings already there**: the program lists them first; the Director closes only with a second
   "save anyway"; the bookings are not moved by the program. (Yes.)
3. **The Excel file of spaces is not practical: do not count on it.** The areas, spaces and lists are typed **in the
   program**, in the calendar's settings. (The reading of the Excel made in step 1 stays in the program, unused.)
4. **The Accountant only sees the calendar** (no accountant role); only the Superior has every tick at first. (Update 67.)

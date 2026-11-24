# Test checklist: the new Calendar (24 November 2026)

**Where:** the test copy in the side pane (`http://localhost:8193`, password `test123`), never the real server. Enter Homs →
door **Calendar**. For each point, tick it when it did what is written. If it did not, write the number and what you saw.

## A. Settings (⚙ Calendar settings)
1. Areas with a colour; spaces (a hall with capacity, a bedroom with beds, a kitchen). → they appear in the week.
2. Untick **"Can be booked"** on a store. → it never shows in the calendar (it stays in the inventory).
3. **A closed period** (e.g. August). → a gold band on those days; booking inside it gives a **warning** ("Save anyway").
4. **A space closed for repairs** for a few days. → shown hatched; booking it is **refused**. *(not yet tested)*
5. "Back to the calendar" brings you back.

## B. The screen
6. Week, Day, Month, List; quick views Everything / Halls / Rooms; search. → each shows the same bookings in its own way.
7. Drag over hours (Day) or days (Week, Month), one or two spaces. → the booking window opens already filled.
8. The Today strip: press each tile. → its list opens; a held date that has passed is red.

## C. Booking
9. **Our activity** every week (Mon and Wed 17–19). Then another one at the same place and time. → the second is **refused**.
10. Weekly with some dates taken. → offered **without those dates**, which are listed.
11. **Outside booking** for an organisation with two persons; choose one. → the organisation shows in the Organisations register.
12. **Price**: "free" is ticked at first; untick, type an amount in USD, add a service and equipment. Save, reopen. → the total is there.
13. **To confirm** with a held-until date. → the space is held; after that date it is red.
14. Sunday, more people than the capacity. → **warnings**. A stay in a hall, or an outside group in a "ours only" space. → refused.

## D. Money and paper
15. **A payment received** before confirming (an advance). → it lists as "waiting for the books"; take it back once, see it struck through.
    **Whose book:** record it as someone who keeps one book (Nagham): the window says "The money goes into: her book" → the payment is in HER list
    "Payments waiting for the books", she makes the entry in her own book; the Accountant sees only "n payments are in the books of holders"
    (no amount). Record it as someone with no book, or choose the Main book: it is in the Accountant's list. Try to choose another person's book → refused.
16. Print the **Receipt** of the booking and of one payment. → "Receipt · وصل استلام" (never "invoice"), the amount **in words in Arabic and
    English**, two places to sign; printed again says **COPY**. *(Arabic words not yet tested)*
17. **Cancel** a booking that has money: keep a part. → asks for the amount per currency; what is given back appears (HR…) in the list of the
    book the money came into (Nagham's payment → Nagham's list, as an expense). Only the Administrator can move it to another book.
18. 🖨 **Print**: the week, the day, one hall's week, the booking sheet. **Excel** of a period and of payments. → the files save and open;
    Reception sees no amounts. *(PDF and Excel saves not yet tested)*
19. **Organisations**: search by name, by person, by phone.

## E. To prepare today
20. Make a hall activity today at 15:00 and a group arriving today in a bedroom. → the tile "To prepare today" lists the hall
    ("before 15:00", what the group asks for) and the bedroom; a cancelled booking is not there.

## F. The calendar phone and the TV
21. Settings → Calendar phones → **Link a phone**, name it, choose a role. → a link code; it works **once**.
22. On the phone page with `#calendar`: type the code, choose **4 digits**. → opens on Today; Week and Spaces work; a private booking says "Reserved".
23. Wrong 4 digits five times → waits 30 seconds. **"I forgot the code"** → asks "Yes, forget this phone"; a new link code is needed.
24. Cut the phone off in the settings. → on its next update it tells it was cut off. *(a real phone, Arabic screen, home-screen icon: not yet tested)*
25. Link a "phone" for the TV, open **/tv** in another browser. → today's halls, the red line, no prices, no phones; it refreshes in a minute.

## G. Roles
26. Sign in as Reception and as the Accountant. → Reception books but sees no price; the Accountant only looks.

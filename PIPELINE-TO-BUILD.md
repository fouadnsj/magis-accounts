# Plan to reach "ready for the build" (set 24 November 2026; Fouad is away, the manager session coordinates)

Rules from Fouad: each job goes to a FRESH session, model Opus (claude-opus-5-5) for creative or risky work (J1 doors page, J2 reports with money); Sonnet (claude-sonnet-5-5) is fine for the lighter jobs (J3 guide/checklist, J4 test data, J5 final check); one writer at a time, each commits only its own
files by path, no build / no installer / no tag (only when Fouad says "build"), never touch the real server or real data
(rehearse on copies; test copy = test-servers/next-test, password test123), `tls/` never opened. After each job the manager:
checks the commit + tests, `npm run build:server`, restarts the preview `magis-next-test`, notes the result here.

## Jobs, in order
- [x] J1 THE DOORS PAGE (b23de65) (Shell): entering a centre shows LARGE, nice door badges inspired by the home page (style, chart, animation
      like or different), each with a warm sentence: from the chart, from the explanation of the logo of each centre, or random deep
      and meaningful sentences from the MAGIS concept note / testimonies / recreated from both, in the same spirit (Arabic/English/
      French; never invent facts or quotes: sentences must be traceable or clearly original). Doors: Accounts, Calendar, Inventory,
      HR (HR = one door for all, separated inside). Rights decide which doors show; a person with one door: still show the nice page
      (Fouad: "it would be a pity to avoid it"). Each door has its own menu + "← MAGIS" back; old calendar and old inventory pages
      leave the menu. Ready-made roles (Director, Accountant, Reception, Store keeper, Coordinator; ticks still editable).
- [ ] J2 CALENDAR STEP 8 rest: reports by organisation and free use, optional reminders, guide, checklist.
- [ ] J3 INVENTORY STEP 5 rest: guide, checklist (door/roles done in J1).
- [ ] J4 TEST DATA (Fouad 24 Nov: "skip the website data, you can create data for test"): create realistic SAMPLE data in the TEST COPY ONLY (test-servers/next-test, never the real db): areas/spaces already typed by Fouad stay; add sample organisations, weekly activities, outside bookings with prices, a stay, holds, payments + one cancellation with a part kept, inventory items with photos placeholders, a problem reported. Clearly sample names (no real people). A script kept in `scripts/` that can be re-run on a fresh copy. Model: Sonnet is fine.
- [ ] J5 Final check: all tests, rehearsal of all updates on copies of the six real databases, test checklist file, a short list for Fouad's last test. Then tell Fouad "ready for the build" and WAIT for his word "build".

## Notes
- Calendar phone: tested comments done (be72374, 89ba6c6, 3d414f8). TV real design (map of areas) = later (step 9).
- Next free database update number: 77 unused, 78 maybe used by nobody yet (check migrations.ts).

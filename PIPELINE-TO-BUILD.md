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
- [x] J2 (guide+checklist only, ab6da64; reports and reminders later): reports by organisation and free use, optional reminders, guide, checklist.
- [x] J3 (guide+checklist, ab6da64): guide, checklist (door/roles done in J1).
- [x] J4 TEST DATA (cf645fb; run on next-test 24 Nov) (Fouad 24 Nov: "skip the website data, you can create data for test"): create realistic SAMPLE data in the TEST COPY ONLY (test-servers/next-test, never the real db): areas/spaces already typed by Fouad stay; add sample organisations, weekly activities, outside bookings with prices, a stay, holds, payments + one cancellation with a part kept, inventory items with photos placeholders, a problem reported. Clearly sample names (no real people). A script kept in `scripts/` that can be re-run on a fresh copy. Model: Sonnet is fine.
- [ ] J5 Final check: all tests, rehearsal of all updates on copies of the six real databases, test checklist file, a short list for Fouad's last test. Then tell Fouad "ready for the build" and WAIT for his word "build".

## Notes
- Calendar phone: tested comments done (be72374, 89ba6c6, 3d414f8). TV real design (map of areas) = later (step 9).
- Next free database update number: 77 unused, 78 maybe used by nobody yet (check migrations.ts).

## Changes decided with Fouad on 24 November 2026 (after the doors page test)
- J2 shrinks: reports by organisation / free use and the optional reminders are LATER (not before the build). J2 = the calendar's guide + checklist only.
- J3 (inventory guide + checklist) joins J2 in ONE light Sonnet job "guides and checklists" (calendar + inventory).
- NEW J1b: no way back inside a door -> an always visible "<- MAGIS . Doors" on every page of a door (J1's session, Opus).
- NEW J6: sign-in + roles made simpler (design with Fouad first; see the proposal in the conversation): one person, one password, ONE ready-made role (a bundle of door ticks) per person on each server; doors come from the role; HR = one tick; every centre's server is its own boss (its Director is the admin), the Coordinator only looks/signs in as; no central admin needed. Build only after Fouad agrees.
- J4 (test data) and J5 (final check) stay as planned, after J6.

# Fouad's comments, third test (25 November 2026) — collected, NOT built yet (he is still testing)

1. **City in the Accounts.** "If everyone enters with the centre door the city has no meaning; even in lists, cities do not matter."
   Analysis (manager, nothing changed): the city comes from the old Excel workbook where one file served several cities. Today it is:
   a field on every register entry (`city_id`, shown in the entry form, defaulted from the book's city or the default city in settings);
   a field on each book (`book.city_id`, the "City" column of Lists → Books); a list "Cities" (Lists → Cities, table `city`: Homs, Aleppo,
   Damascus in the test copy); a column in the Excel export and in the Excel import (sheet "Cities", columns "City"); and the "city" shown
   in the compare screen. Since each centre now has its own database the choice is always the same.
   Options: (A) hide it everywhere on screen (entry form, Lists → Cities tab, Books column, Compare) and keep the column and the old values
   in the database, the Excel export/import untouched (no data lost, no update, small change); (B) remove it for good (database update,
   export/import changes, risk). Recommendation: A.

2. **Export section** "needs review, and maybe move it to Reports, with more options to export."
   Analysis (manager, nothing changed): today the menu item "Export" (Files.tsx, rights `data.export`/`data.import`) holds ONE thing: "Export to Excel" of
   the register (a Transactions sheet in the workbook's column order, with filters: all periods or from/to month, book, project; options: register only
   / with lists / with reports / confidential for the Superior) and, when the register is empty, "Start from the Excel workbook" (import Master Sup /
   Master Com). Reports (Reports.tsx) has its own tabs: Summary, Explore, Quarters & categories, Monthly, By project, All centres, Funding, Exchange
   log; some have a print/PDF, none a clear "Export" button of its own as far as the manager has seen (not checked in detail).
   Proposal to discuss: in Reports, an "Export" button on each report tab (Excel and PDF of what is on the screen, with its period and filters),
   plus a general "Export the register / the books / the lists" under one "Export" entry inside Reports; keep the import ("Start from the workbook")
   where it is (Settings, only when the register is empty). The new doors also export their own things (calendar bookings Excel, donor report PDF+Excel,
   printed pages) — decide whether Reports of the Accounts door should list those too or each door keeps its own.

3. **Projects in Lists.** "We do not use it now because it is related to the budget lines. If it is useless in the accountant page, move it to the budget
   section. It will be helpful only if we have a certain specific donation."
   Analysis (manager, nothing changed): Lists → "Projects" (`FundsTab` in `ListsPage.tsx`, table `account`; test copy: Deir, Center, harat,
   Furniture, Network, Building, Canzali) shows each project with its grant and donor, dates, the share of the grant here and how many entries use
   it; actions: new private project (money with no grant that one wants to follow alone: private gift, money from the order), merge two projects,
   "outside the budget" (money spent outside the centre's budget, e.g. the monastery), dates. A project is created from the Grants page for a grant
   (Administrator only). Since step 2 only the Administrator sees donors and grants, so for the accountant or a Director this tab is mostly
   names and counts. In entries a project is only asked for money outside the budget (`fundOfRow`).
   Proposal: take "Projects" out of Lists and put it inside the Budget section (Lists → Budget, or the Budget page) as a small block "Special funds ·
   projects" shown only when the Administrator has grants or private projects (or always for the Administrator, hidden for the others); keep the
   data and the rules as they are (no update). To discuss: the word "Project" vs "Fund".

4. **Calendar for everyone, view only.** "The calendar must appear for everyone, view only."
   Analysis (manager, nothing changed): today the Calendar door shows only for someone with a calendar tick (`cal.view`, `src/doors.ts`
   line 38). The ready-made roles that have it: Director and Administrator (all), Reception, Coordinator (workshops), and the Accountant
   ("calendar view only, no prices"). A Book holder and a Store keeper (and an HR keeper later) have none, so they see no Calendar door.
   Proposal: every person of the centre gets the calendar to LOOK at (activities, spaces, who is where, "To prepare today"), with no prices, no
   money, no contacts (a private booking stays "Reserved · محجوز"), and cannot change anything: i.e. `cal.view` becomes part of EVERY role
   (and of a Custom role by default), and the server/screen already hides contacts and prices without their ticks. Question: does "everyone"
   include the phones of the calendar (already view only) and a person with no role at all? Recommendation: every person with an account of the
   centre, yes; no account = no.

5. **Inventory values only for the Administrator** (screenshots: the home figure "$4,230.00 · value (bought or estimated)" and "2 · with staff").
   "In the inventory, no one needs to see the total value except the administrator."
   Analysis (manager, nothing changed): the value is behind the tick `inventory.values` ("inventory values", `src/roles.ts` line 43). Today it is in
   the Director role, the Store keeper role (`doors.ts` line 89: view, values, manage) and the Administrator; the baseline said Director and keeper (the
   accountant is a keeper) see values. It appears as the big figure on the inventory home, on each space card, the item pages, the donor report
   (value per item) and the space sheet already hides it. Proposal: `inventory.values` only in the Administrator role (and refused by the server
   to every other role and exception, like Respo and Grants — i.e. one more "Administrator-only" tick); the Store keeper and the Director keep
   everything else (items, counts, moves, state) but no value; the donor report (PDF/Excel) shows values only when the Administrator makes it
   (to confirm: should the donor report keep the values? donors usually want them). Note: the old accountants' tick from update 55 (keeper rights)
   would then lose the values on the real databases: a "less" in the rehearsal, to say to Fouad in advance.

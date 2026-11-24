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

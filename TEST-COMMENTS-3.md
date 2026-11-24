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

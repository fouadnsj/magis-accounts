# حسابات بناء حمص · Homs Building

A separate desktop program for the accounts of the Homs building site, made from MAGIS Accounts
(branch `homs-building` of the `magis-accounts` repository). It is temporary: the building ends in 2027.

- **The accountant's Windows PC** holds the real database. He starts it once from `Homs compte.xlsx`
  (New database), works there, and sends a backup (`backups` folder next to the file) to Fr. Fouad.
- **Fr. Fouad's Mac** opens those backups to look and export to Excel only.

Rules (Fouad, 17–18 Oct 2026): budget per heading; Kind = line (Materials / Wages / Other); payment date counts;
the rows from Excel keep their typed rate, new rows take the last exchange's (never typed); an exchange is not spending;
the number and the bill code (`0003 TO 24 2`) never change: rows are **cancelled**, only the Superior deletes.

- Juge: `tests/juge-building.test.ts` (reads `../../Homs compte.xlsx`).
- Windows installer: push a tag `building-vX.Y.Z` → GitHub Actions → Releases. Mac: `construire-mac.command`.
- Version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.

# START HERE — new conversation (14 November 2026)

Written at the end of a long conversation (13–14 November 2026), so that a new one can go on without it.
Read this file first. The older handover `START-NEW-CONVERSATION.md` (19 October) and `REPRISE.md` (full history)
are still true for how the program is built. Memory notes are in
`~/.claude/projects/-Users-fouadsj-Documents-Claude-Projects-Comptability/memory/` (MEMORY.md is the index).

## 1. How to work with Fouad
- Jesuit priest in Syria, **not a developer**. English, French, Arabic. He tests and sends notes; you fix.
- **Ask first** when a rule is unclear (one short question, with your recommended answer). Never invent names or numbers.
- **Never build installers or change the version until he says "build".** Commit and stop.
- **Never touch the real server (192.168.1.55) or real data.** Test on copies in the session scratchpad.
- Test passwords: on the test servers below everything is **test123** (Fouad asked on 14 Nov). Otherwise the rule
  for passwords Claude sets is "fouadsj" (memory note test-password).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Checks before finishing: `./node_modules/.bin/tsc --noEmit -p .` and `./node_modules/.bin/vitest run` (196 pass),
  then `npm run build` and `npm run build:server`, restart the preview server, look in the browser pane.
- Node is at `/Users/fouadsj/.local/node/bin` (add to PATH). Long Python edits: write a script file in the
  scratchpad and run it (long heredocs are sometimes refused by the safety check).

## 2. Where things stand (git)
- Branch **`release-0.10.0`** = version 0.10.0, **ready to build, not built**: MAGIS phone app (offline,
  iPhone/Android, certificate, port 8444) + the HR roles of 0.9.2 (0.9.2 was built but never installed).
  Details: `RELEASE-0.10.0-READY.md`. Fouad has not said "build" yet.
- Branch **`main`** = 0.10.0 + everything below (not built either). If Fouad says "build", ask whether to build
  `release-0.10.0` or `main` (main is probably what he wants now).

### Done on main since 0.10.0 (13–14 Nov)
1. **Communities step 1**: the Jesuits' own door `/jesuits` (name + password, opens his community; sign-out comes
   back there); one password per person, the offices (Superior, Econome, Minister, Administrator) are **hats** at
   the top, no office password; the community's sign-in lists the Jesuits only; **one language at a time** in the
   communities (`cty-lang` on the device; the centres keep `lang`).
2. **Step 2**: the econome's desk in 6 places with tabs (Today, Entries, The brothers, End of the period,
   With the Province, Settings); the Superior's own short menu (To approve, Read the month, The community,
   Entries, Settings).
3. **Step 3**: a community sends its month **directly** to the country econome on the same server, and takes his
   answers back — **the file stays the main way** (Fouad).
4. **Step 4**: receipts (photo/PDF) on community entries; in the entry sheet the amount and the category change
   separately (Fouad's note); the **offline phone for the Jesuits** (phone.html → "Jesuit communities"; his pocket;
   LOC/USD/EUR; any exchange).
5. **Backups**: "Download the latest copy (to send)" (also with the "Exports" tick, for the accountant).
6. **Desktop app**: remembers every server; "Change server" on the first page opens the list. *Not tried in a
   built app yet.*
7. **Phone**: "The full program" button while connected (a session with the owner's rights, 📱 to go back);
   manifest scope "/" (on an iPhone the icon must be added again once).
8. **New tick "Adds book holders"**: the accountant adds book holders, their books and passwords — never the
   Superior, never another role, never the roles page. Fouad chose this over "never above yourself".
   On his real server he must untick "Users and permission profiles" for the Accountant after installing.
9. Coordinator → Databases: "Jesuit communities" is a card; **New database** starts with 4 cards
   (MAGIS centre accounts · HR · Jesuit community · Country econome) + "From a database file".

## 3. Testing (what Fouad is doing now)
Two test servers in `.claude/launch.json` (start with the preview tool; restart after each build):
- **`cty-review`** — `http://localhost:8150` (plain http: **use this in the browser pane**). Data:
  `Comptability/test-servers/cty-review` (outside the code, never in git: it holds a copy of real data)
- **`magis-phones-check`** — `http://<Mac Wi-Fi IP>:8140/phone` (start page), https on 8443 (computers) and 8444
  (phones), for the iPhone. Data in `Comptability/test-servers/phones-check`. Its phone certificate ends **98D8 F8B6**
  (Fouad's iPhone trusts it). The Mac's Wi-Fi address changes (192.168.70.42 on 13 Nov, 192.168.1.154 on 14 Nov).
- Both hold the same six databases, **every password test123**: MAGIS Homs (copy of the real one), Homs 2027
  (preview), HR test roles, Homs (demo), Damascus (demo), Syria (demo). Administrator: **Fouad / test123**.
  Demo people — Homs: Sup-H (Superior+Admin), Eco-H (Econome+Minister), Jes-H1, Jes-H2; Damascus: Sup-D
  (Superior+Econome), Min-D (Minister), Jes-D1; Syria: Eco-Syria. (A Jesuit "ff" was added by Fouad's tests.)
- To start again from fresh demo data: `tester-communautes.command` (`server/demo-communities.ts`);
  `test-servers/setpw.mjs <folder>` sets every password of a test folder to test123 (test folders only).
  `cty-review` also holds "fg", a database Fouad created while testing New database.

## 4. Still open
- Communities: the phone for the **house** (minister) and the **econome's cash** (today the phone links the person
  signed in: his pocket); the **guide in plain words** per role; a test on a real phone with a community.
- Report of suggestions: `../Cty/REVIEW-community-2026-11-13.md` (steps A–H; A–G done, H mostly done).
- Phone guide steps in AR/EN/FR as tried on the iPhone; phone screens in Arabic/French not looked at; Android not
  tried on a real phone.
- Older ideas waiting (see memory): 2027 rehearsal, French for newer screens, Coordinator reports, books overview,
  building view, Beit Alberto (phone step 3).

# Idea — the website's application, going online, and a central server (22 November 2026)

Kept for when Fouad comes back to it. Nothing here is built.

## Fouad's question (22 November 2026)
Since the calendar and the inventory are now in MAGIS Accounts: what would it cost to move the whole web application
(Beit Alberto: people, attendance, activities, public site) into this application? What would it cost to put this
application online? And if it is not online, what is needed to gather the databases of the 4 centres on a main server?
His thought: the only things missing are the people's data and the attendance.

## Fouad's feeling (after reading the answer below)
**Keep the application local** (each centre keeps its own server and works with no internet). Each centre's server sends
its **secondary backup** to a **central server**. The central server **checks the latest backup of each centre and applies
it**, to make **reports and a general view**.

This is the direction to follow unless he changes his mind.

## What already exists for that idea (checked in the code, 22 November 2026)
- Each centre server can send its protected copies (`.magisbak`, encrypted with the copy password set in
  Admin → Backups) to a **mirror folder** (a folder name in the server's settings). Attachments follow.
  If that folder is synchronised (OneDrive, Dropbox, Syncthing, a shared drive…), the copies travel by themselves.
- The main server's **Coordinator → Databases → "Bring a copy from another server…"** takes such a copy and keeps it as a
  **read-only copy**: nobody can sign in to it or change it there; it shows in the Coordinator's totals, the
  "what is waiting" tab, the grants readiness, the inventory totals. The Coordinator warns when a copy is **more than
  30 days old**. Bringing a newer copy replaces the older one.

## What is missing for his idea (small, to build when he decides)
1. **Automatic pick-up.** Today someone presses *Bring a copy…* and chooses the file. To do it by itself the main
   server would watch a folder (one sub-folder per centre), take the **newest** `.magisbak` of each centre, open it with
   the copy password, check it is a newer version, and apply it as that centre's read-only copy. It writes a line in the
   audit trail ("Homs: copy of 22 Nov 02:10 applied") and keeps the previous one for a few days.
2. **A "general view" page** at the main server: one table, a row per centre — date of the last copy, months not closed,
   cash, grants waiting, inventory total, bookings of the week — with a red mark when a copy is late (more than 2 days).
   Most figures already exist in the Coordinator; this gathers them on one screen.
3. **Reports across centres**: the figures of the 4 centres side by side (and added up) for a month or a year, with
   Excel. (The hosting report and the inventory totals already exist per centre.)
4. **The copy password** shared between the centres' servers and the main one (one password, kept safely, on paper too).
5. **A way for the copies to travel**: a synchronised folder (simplest), or an upload over a private link (VPN) later.

## What the main server and each centre need
- One computer at the main place that stays on (Windows with the MAGIS Server, as now), a UPS, a disk with room for 4
  centres' copies, and its own backup.
- At each centre: the server already there, the mirror folder set, internet at least once a day (even slow: copies are
  small; attachments larger), and one person who checks that the copies arrive.
- No public address, no opening of the centres' network: nothing is exposed to the internet.

## Why not online (my advice, unchanged)
The program was made for a local network; financial data and the personal data of minors would sit on the internet; and
if a centre's internet is down nobody could work on the computer. The central server by copies keeps every centre
independent, and gives the general view.

## The web application (Beit Alberto) — if it is moved into this app later
Not only people and attendance are missing. Also: activities with registrations, questions, tutors, capacity and fees;
partner organisations and their contacts; the privacy rules (erase after 3 years, minors, duplicates — 117 groups of
possible duplicates); 10,000 people and 130,000 check-ins to import; statistics per centre and for all; and the public
website with online registration (which cannot live in the accounting server).

Suggested shape: **people, check-in and activities inside each centre's database** (a section like the inventory or the
calendar; each centre sees its own people; the Coordinator adds up the centres). Accounting stays on the local server.
The public site stays a small separate online piece with no accounting in it.
Rough size (an estimate, not measured): about **12 to 16 working sessions** for the in-app part, plus **3 to 5** for a
public part. The other path — finishing the Laravel application already built (`Alberto WebSite/next`) and linking
payments to the accounts by a monthly file — is fewer sessions but keeps two programs, two logins and two backups (and
the calendar and inventory exist in both).

Putting this application online: roughly a small rented server (about $5–10 a month, to be checked before buying), a domain
(about $10–15 a year), backup storage; 2 to 4 sessions to set it up and secure it, and someone to look after it.
The current Hostinger plan cannot run this program.

## Questions to answer when he comes back
1. Should people be **shared across centres** (one person = one record) or **separate per centre**?
   (Today's decision for the website was one database; in this app each centre has its own database.)
2. How reliable is the **internet** in each centre, and who is the technical person there?
3. Do we **stop** the website program already built, or **finish** it?
4. Is the **public site** still needed online? If yes, who looks after it?
5. For the central server: where will it stand, and who checks that the copies arrive every day?
6. Do we start with a **small test** (one centre's people and check-in, from a copy of the cleaned data) to see how
   the app behaves with 10,000 people?

Related: `~/.claude/.../memory/merge-web-app-idea.md`, `../Alberto WebSite/REPRISE.md`, `../Alberto WebSite/next/docs/data-model.md`.

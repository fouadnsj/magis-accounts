# Version 0.10.0 — ready to build (not built)

Status on 2026-11-13: everything below is committed (last commit `fb12c5a`). Nothing is built, nothing is tagged.
To build: say "build" — the version number goes in the 4 usual files, then Mac + Windows server + Windows desktop.

## What 0.10.0 brings since 0.9.2 (0.9.2 was built but never installed)

**From 0.9.2 (HR roles)**
- Three new ticks in the HR roles page: the cost of an hour, Donors & funding, Reports. Excel needs the "Exports" tick.
- The Superior gets them; a centre's keeper gets only Excel.

**The phone (new)**
- A home-screen app for iPhone and Android, served by the centre's server (no App Store).
- Records expenses, income and exchanges (dollars → pounds) with no connection, with up to 3 photos of the receipt; sends them when it is back on the centre's Wi-Fi. Transfers stay on the computer.
- Linked once by its owner (name + password), then opened with a 4–8 digit code. Valid 30 days after the last sync.
- The server checks every row with the owner's rights, as on the computer. Refused rows come back under "To fix".
- Admin → Users → Phones: the linked phones, "Cut off", the start address and the certificate's number.
- A start page `http://<server>:8080/phone` (AR/EN/FR) gives the certificate and the steps.
- A separate address for phones (port 8444) with a certificate limited to local network addresses. The computers keep port 8443, unchanged.
- The Windows installer opens port 8444 in the firewall.
- Guide: a "The phone" section.

**Tested**
- 190 automatic tests.
- On Fouad's iPhone (13 Nov 2026, test server on the Mac): certificate, home-screen icon, linking, saving offline, photo. His notes led to: the waiting numbers per book, opening a photo full screen, asking before removing a photo or a row, exchanges.

## Still to do before or with the build
- The detailed phone steps in the guide (AR/EN/FR), as tried on the iPhone.
- The phone screens in Arabic and French were not looked at.
- Android not tried on a real phone.
- Update the Windows app on the Superior's and the accountant's computers (new Admin and HR screens); the others can wait.

# First setup guide (Administrator and Inginer)

The home page shows a **Prima configurare / First setup** panel with four steps. Each ticks itself off; the panel disappears when all are done.

## 1. Two Engineers
Under **Utilizatori / Users** create at least two accounts with the role **Inginer / Engineer**. One drafts and submits a data sheet, the other verifies and activates it (the author can never verify their own sheet).

## 2. Activate the data sheets
No measurement can be entered until a sheet has an **active** revision. The seeded sheets are drafts transcribed from scans:

1. Engineer A opens **Fișe tehnice / Data sheets** → a sheet → its draft revision.
2. On the draft, the list **Valori de verificat față de documentul original** shows values that looked inconsistent in the scan (level A = probably wrong, B = worth a look). Check each against the paper original and correct it in the construction row.
3. The IEC 60228 checks must pass (or carry a recorded reason, see the sheet). Then **Trimite la verificare / Submit for verification**.
4. Engineer B opens the same revision, checks it, and presses **Verifică și activează / Verify and activate**.
5. From then on measurements use that sheet. Later changes are a *new revision*; old measurements keep the limits of their time.

Tip: start with the one family you will measure first (for example the rigid aluminium conductor) and activate the rest later; families you do not use can be switched off under **Date de bază → Familii de produs**.

## 3. Crew start dates
**Date de bază → Schimburi / Database → Crews**: enter for each crew (A, B, C) the first day of its day shift in the current cycle. The cycle itself (default 4 day shifts, 2 off, 4 nights, 2 off) is set under **Setări → Ture / Settings → Shifts**. Until a crew is saved here the dates are placeholders from the first start.

## 4. A first backup
**Setări / Settings → Backup acum / Back up now**. Set the backup folder first if it should be on another machine (see `docs/TEST-PE-CALCULATOR.md`, "Backup to a network folder").

## Reviewing the wording
`docs/revizie-texte.xlsx` lists every screen text in Romanian and English side by side. Colleagues fill the *corrected* columns and the *Comment* column and send the file back; keys must not change and `{placeholders}` must stay as they are. Regenerate the file with `node tools/export-texts.js`.

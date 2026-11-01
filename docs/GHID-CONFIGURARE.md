# First setup guide (Administrator and Inginer)

The home page shows a **Prima configurare / First setup** panel with four steps. Each ticks itself off; the panel disappears when all are done.

## 1. Two Engineers
Under **Utilizatori / Users** create at least two accounts with the role **Inginer / Engineer**. One drafts and submits a data sheet, the other verifies and activates it (the author can never verify their own sheet).

## 2. Activate the data sheets
No measurement can be entered until a sheet has an **active** revision. The seeded sheets are drafts transcribed from scans:

1. Engineer A opens **Fișe tehnice / Data sheets** → a sheet → its draft revision.
2. On the draft, the list **Valori de verificat față de documentul original** shows values that looked inconsistent in the scan (level A = probably wrong, B = worth a look). Check each against the paper original and correct it in the construction row.
3. **Check each row against the paper original** (the second engineer can do it too): on the revision page press **Verificare față de original / Check against the paper original**. For every row type the values from the paper into the boxes on the right; the application shows ✓ or ✗ next to each, live. When everything matches press **Coincide cu originalul — următorul / Matches the original — next**; a row you looked at by eye can be ticked without typing. If something differs, press **Corectează rândul / Correct the row**, fix it and **Salvează și înapoi la verificare / Save and back to the check**. The revision page shows how many rows are checked (informative: it never blocks activation); editing a row clears its tick.
4. The IEC 60228 checks must pass (or carry a recorded reason, see the sheet). Then **Trimite la verificare / Submit for verification**.
5. Engineer B opens the same revision, checks it, and presses **Verifică și activează / Verify and activate**.
6. From then on measurements use that sheet. Later changes are a *new revision*; old measurements keep the limits of their time.

Tip: start with the one family you will measure first (for example the rigid aluminium conductor) and activate the rest later; families you do not use can be switched off under **Date de bază → Familii de produs**.

## 3. Crew start dates
**Date de bază → Schimburi / Database → Crews**: enter for each crew (A, B, C) the first day of its day shift in the current cycle. The cycle itself (default 4 day shifts, 2 off, 4 nights, 2 off) is set under **Setări → Ture / Settings → Shifts**. Until a crew is saved here the dates are placeholders from the first start.

## 4. A first backup
**Setări / Settings → Backup acum / Back up now**. Set the backup folder first if it should be on another machine (see `docs/TEST-PE-CALCULATOR.md`, "Backup to a network folder").

## 5. Team modules (Maintenance, Technical, Quality, Meetings)
They are off until you switch them on: **Setări → Module / Settings → Modules**. In the same page, under the team modules:
- set the **default level** per module (none / view / enter / lead);
- set the **numbering** (for example `MT-{yyyy}-{seq:4}`) and the team codes;
- choose whether anyone may update Technical tasks;
- set the **non-conformity closing rules** (what must be filled in before closing) and the evaluation deadline.

Per person: **Utilizatori / Users** → open a user → **Acces la module / Module access**. Then:
- **Date de bază → Persoane (echipe) / Database → People (teams):** the people who get tasks, each with a team. A person can be linked to a login so that "Mine" works.
- **Ședințe → Programări / Meetings → Schedules:** check the repeating meetings (the times are the owner's defaults; change them freely).
- **Mentenanță → Preventiv / Maintenance → Preventive:** make the first plans with the **Zilnic / Daily** (working days, made the day before), **Săptămânal / Weekly** or **Lunar / Monthly** presets.

## 6. Custom fields and lists
**Administrare → Câmpuri proprii / Administration → Custom fields.**
- **Make a list first** on the **Liste proprii / Custom lists** tab, if a field should be a choice from a list. Write one item per line, optionally `Romanian | English`.
- **Add the field:** what it applies to (tasks, of all teams or one; non-conformities; meetings), its type, its name in Romanian and English, and whether it is required and shown as a table column.
- **Fields are never deleted.** Untick **Activ / Active** to hide one. Its values stay on the records and in the exports.
- **The type of a field cannot change after it is made.** A list used by an active field cannot be hidden.

## 7. Calculated fields (formulas)
Choose the type **Număr calculat (formulă) / Calculated number (formula)**.
- **Writing it:** press the field and function chips to build the formula, for example `round([Timp oprire] / 60 * [Preț oră]; 2)`, or start from one of the examples made from your own fields. Field names go in square brackets, and function arguments are separated by `;`. **Cum se scrie o formulă / How to write a formula** under the editor lists everything.
- **Trying it:** type sample values in the preview. The result, or the reason it cannot be worked out, shows at once.
- **Empty is not zero:** an empty input gives an empty result. Use `if(empty([field]); 0; [field])` where a missing value should count as 0. Dates count as days, so `[End] - [Start]` is the number of days between them.
- **Changing a formula** applies to each record when it is saved. **Recalculează toate / Recalculate all** on the field's page applies it to every record at once and is written to the audit log. Every version of a formula is kept on that page.
- **Order:** a formula may use other calculated fields made *before* it.

## Reviewing the wording
`docs/revizie-texte.xlsx` lists every screen text in Romanian and English side by side. Colleagues fill the *corrected* columns and the *Comment* column and send the file back; keys must not change and `{placeholders}` must stay as they are. Regenerate the file with `node tools/export-texts.js`.

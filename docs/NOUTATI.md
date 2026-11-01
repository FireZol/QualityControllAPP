# What's new (Noutăți)

Screen names are given as they appear in the application: **Romanian / English**.

## 0.10.0-beta.1 (November 2026)

The first version with the team modules. Everything measured, every data sheet and every user from 0.9.x stays exactly as it was. This was checked before release with `tools/upgrade-rehearsal.js`, which upgrades a database made by 0.9.0-beta.3 and compares every row.

### Before you upgrade
1. **Setări → Backup acum / Settings → Back up now.**
2. Follow `README-INSTALARE.md`, section 6. At its first start the new version takes another backup, then updates the database structure.
3. **There is no way back to 0.9.x on the upgraded database.** Passwords are stored more strongly from this version on, and 0.9.x cannot read them. To return to the old version, start it on the backup taken just before the upgrade (section 6 explains how). Anything entered after the upgrade is not in that backup.

### After you upgrade
- The new modules are **off** until an Administrator switches them on. Go to **Setări → Module / Settings → Modules** and tick Maintenance, Technical, Quality and Meetings as needed. Then set who may do what: **Utilizatori / Users** → a user → **Acces la module / Module access**.
- Read `docs/GHID-CONFIGURARE.md`, sections 5 to 7, for the first steps in the modules.

### New
- **Modules for the teams:**
  - **Tasks** for Maintenance, Technical and Quality, with statuses, people, checklists, plan / postpone, bulk changes, print and Excel / CSV export.
  - **Meetings**, including repeating ones (Technical and Maintenance 08:30 and a 17:00 recap, Quality Monday and Wednesday 15:00; all editable), with attendance, minutes, and decisions that become tasks.
  - **Preventive maintenance plans** that make their tasks on time.
  - **The non-conformity register** with evaluation, closing rules set in Settings, recurring cases and a Top for the quality meeting.
- **Notifications** (the bell) for assignments, status changes, meetings and non-conformities.
- **A new look:** a menu on the left, a Light / Dark / PC default theme, a home page with "Needs your attention", and large touch targets everywhere.
- **Custom fields and lists:** an Administrator adds fields to tasks, non-conformities and meetings without a new version of the program. They can be text, a number with a unit, a date, yes / no, or a choice from your own list. They appear in the form, on the record, as table columns, in the filters, in the exports and on the printed sheets. Nothing is deleted: a field is hidden and its values stay. A meeting schedule can give its meetings default values, and the non-conformity search also looks in the text fields.
- **Calculated fields (formulas):** a number worked out from other fields, for example `round([Timp oprire] / 60 * [Preț oră]; 2)`.
  - The formula editor has a live preview, and forms show the result while people type.
  - A changed formula never changes old results by itself. A record gets the new formula when it is saved, or when an Administrator presses **Recalculează toate / Recalculate all**.
  - The measurement formulas used on certificates (mass per metre, resistance, ovality, verdicts) are not editable. Their parameters still are, under **Date de bază / Database**.

### Fixed
- **A reading exactly on a limit is "in limits".** Before, rounding noise in the computation flagged some of them, for example 609,4 g/m against a maximum of 609,4. Records already saved keep the verdict they were saved with. A re-saved or corrected record gets the right one.
- **Dates:** impossible days such as 30 February are refused everywhere, instead of being moved to March.
- **Error notices:** a form that comes back with an error now says at the top that nothing was saved, and puts the cursor on the first marked field. Numeric settings show their allowed range.
- **Security:**
  - stronger password storage, upgraded silently at the next sign-in;
  - sessions end after 14 days at the latest;
  - a database made by a newer version is refused instead of being run by older code;
  - extra protection headers;
  - very large uploads get a clear answer instead of a cut connection.
- **Monitoring:** HEAD requests (used by uptime checks) are answered.

### Known limits
- The old Excel register of non-conformities cannot be imported yet. A sample file is needed first.
- Custom fields are not available on measurements.
- Meetings made by a repeating schedule start without custom-field values.

## 0.9.0-beta.3
Conductor QC: measurements, data sheets with a two-engineer activation, base data, register, analyses, finished cable and certificates, backups.

# Factory PC test checklist

Things that could not be tried in the development environment (Linux, headless Chromium only). Tick each line; write what you saw next to any line that fails and send it back.

## A. Printing in every browser (Chrome, Edge, Firefox)

Do this on a factory PC, once per browser. Use a real data sheet that has at least 30 rows (for example the aluminium rigid-conductor sheet).

| # | Step | Expected |
|---|------|----------|
| 1 | Open **Fișe tehnice** (Data sheets) → a sheet → **Tipărește** (Print) | The printable page opens, no menu bar |
| 2 | Press **Print** (or Ctrl+P), choose *Save as PDF* or a real printer, paper **A4** | The preview shows numbered pages: "Pag. 1 / N" at the bottom, header repeated on every page |
| 3 | Check the last page | The page count N equals the number of preview pages; no row is cut in half |
| 4 | Change the **Language** in the toolbar to the other language | The page reloads in that language; numbers use the language's decimal mark |
| 5 | Open **Registru** (Register) → filter → **Tipărește registrul** | Landscape page; choose A3 or landscape in the dialog; rows are not cut |
| 6 | Repeat steps 1–3 with *Margins: None* and *Default* | Text is not cut at the edge |

Notes: Firefox has no CSS page-number boxes, so the numbering is built by `print-paginate.js`; this is the main thing to check there. If the page numbers show "Pag. 1 / 1" on every page, tell us the browser and its version.

## B. Windows scripts (Windows 10/11 or Server, Node.js ≥ 22.13 in `node\`)

| # | Step | Expected |
|---|------|----------|
| 1 | Double-click `start.bat` | A console opens; on the first start it shows the **admin** box with a one-time password — write it down |
| 2 | Open `http://localhost:8080/` in the browser | The login page |
| 3 | Log in as `admin`, change the password | The home page with the **Prima configurare / First setup** panel |
| 4 | Close the console (Ctrl+C), right-click `instalare-serviciu.bat` → **Run as administrator** | "Gata." message, no error |
| 5 | Run `schtasks /run /tn ROMCAB-CTC` and open the page again | The application answers; `data\server.log` has the start-up lines |
| 6 | Restart the computer without logging in | The application answers again after boot |
| 7 | End the task (`schtasks /end /tn ROMCAB-CTC`), wait about a minute | (Only if the process crashed it restarts; a normal end stays stopped.) Start it again with `schtasks /run` |
| 8 | Open the page from **another PC** in the network (`http://<server>:8080/`) | The login page; if not, open TCP 8080 in the Windows firewall |
| 9 | Run `dezinstalare-serviciu.bat` as administrator | The task is removed; `data\` is untouched |

### Backup to a network folder

The task runs as the **SYSTEM** account. On a network share SYSTEM is the *computer account* (`DOMAIN\SERVERNAME$`), not a person, so give that account write permission on the share. Test: **Setări → Backup acum** with the network folder set; the file must appear there. If it fails the page says "Backup-ul a eșuat".

## C. Result

Send back: the browser versions used, which lines failed, and a photo or PDF of a printed sheet that looks wrong.

# ROMCAB CTC — instalare (pentru IT)

Aplicația este un singur folder pe serverul Windows. Nu se instalează nimic altceva și nu este nevoie de internet.

```
C:\ROMCAB-CTC\
  node\      Node.js portabil (LTS, versiunea 22.13 sau mai nouă), dezarhivat, fără instalare
  app\       codul aplicației
  seed\      datele inițiale (folosite doar la prima pornire)
  data\      baza de date ctc.db (se creează singură)
  backups\   locul implicit al copiilor de siguranță
  start.bat, instalare-serviciu.bat, instalare-serviciu.ps1, dezinstalare-serviciu.bat, config.example.json
```

## 1. Instalare

Pachetul de instalare este `ROMCAB-CTC-<versiune>.zip` (verificati suma `.sha256`); se dezarhiveaza in `C:\`, rezultand `C:\ROMCAB-CTC\`. Se construieste cu `node tools/make-release.js`.

1. Copiați folderul `ROMCAB-CTC` pe server (de exemplu `C:\ROMCAB-CTC`).
2. Descărcați o singură dată, de pe un calculator cu internet, arhiva **Windows x64 (.zip)** de la nodejs.org (versiunea LTS, cel puțin 22.13) și dezarhivați-o în `C:\ROMCAB-CTC\node\`, astfel încât să existe `C:\ROMCAB-CTC\node\node.exe`.
3. (Opțional) Copiați `config.example.json` ca `config.json` și ajustați portul, adresa și numele. `start.bat` face această copie automat dacă lipsește.

## 2. Prima pornire

1. Rulați `start.bat` (dublu-click). Se deschide o consolă.
2. La **prima pornire** consola afișează un cadru cu contul **admin** și o **parolă unică**. Notați-o imediat: nu se mai afișează. Baza de date și datele inițiale (liste, tabele IEC 60228, fișe tehnice în stare „ciornă”) se creează automat.
3. Deschideți `http://localhost:8080/` (sau portul din `config.json`), autentificați-vă cu `admin` și parola unică; aplicația cere schimbarea parolei.
4. Din **Utilizatori** creați conturile: cel puțin doi utilizatori cu rolul **Inginer** (unul elaborează o fișă, celălalt o verifică și o activează) și conturile **Personal** pentru CTC.
5. Fișele tehnice încărcate inițial sunt **ciorne**. Un inginer le verifică față de documentele originale, iar un al doilea inginer le activează; până atunci nu se pot introduce măsurători.

## 3. Pornire automată la boot

1. Opriți consola de la `start.bat` (Ctrl+C) după ce ați notat parola de la prima pornire.
2. Click dreapta pe `instalare-serviciu.bat` → **Run as administrator**. Se înregistrează sarcina programată **ROMCAB-CTC** (rulează `run-server.bat`; pornește la boot, rulează chiar dacă nimeni nu este autentificat, se repornește automat la oprire). Aceasta folosește doar Task Scheduler din Windows, fără programe externe.
3. Pornire imediată: `schtasks /run /tn ROMCAB-CTC`. Jurnalul consolei este în `data\server.log` (peste 5 MB se mută la pornire în `data\server.old.log`).
4. Ștergere: `dezinstalare-serviciu.bat` (datele nu se modifică).
5. Deschideți în firewall-ul Windows portul ales (implicit TCP 8080) pentru rețeaua internă.

## 4. Port, adresă, nume

- Din aplicație: **Setări** (Administrator) → port, adresa de rețea (`0.0.0.0` = toate interfețele), nume public (de exemplu `ctc.romcab.local`, înregistrat de IT în DNS). Modificările de port / adresă / nume se aplică **după repornirea** serviciului: `schtasks /end /tn ROMCAB-CTC` apoi `schtasks /run /tn ROMCAB-CTC`.
- La prima pornire valorile vin din `config.json`; după aceea contează cele din Setări.
- Dacă s-a salvat un port greșit și aplicația nu mai răspunde, porniți temporar cu variabila de mediu `CTC_PORT` (de exemplu `set CTC_PORT=8080` înainte de `start.bat`); `CTC_BIND` are același rol pentru adresă.

## 5. Copii de siguranță

- **Setări → Backup**: folderul (local sau de rețea, de exemplu `\\server\backup\ctc`), backup automat pornit/oprit, ora zilnică, numărul de copii păstrate, butonul **Backup acum**.
- Copia se face cu aplicația pornită (copie consistentă a bazei de date), în fișiere `ctc-AAAALLZZ-OOMMSS.db`.
- **Restaurare**: Setări → alegeți fișierul → scrieți numele lui pentru confirmare. Înainte se face automat o copie de siguranță a bazei curente.
- Un backup se face automat și înaintea oricărei migrări a structurii bazei de date.
- Pentru siguranță suplimentară, includeți folderul de backup în copiile de siguranță ale serverului.
- Sarcina rulează ca **SYSTEM**. Pentru un folder de rețea, dați drept de scriere pe share contului calculatorului (`DOMENIU\NUME-SERVER$`), nu unui utilizator; verificați cu **Backup acum**.

## 6. Actualizare

1. Opriți serviciul: `schtasks /end /tn ROMCAB-CTC`.
2. Înlocuiți folderul `app\` cu cel nou. **Nu atingeți** `data\`, `backups\` și `config.json`.
3. Porniți serviciul. La pornire, structura bazei de date se actualizează automat, după un backup automat.

## 7. Cerințe

Windows Server / Windows 10–11 x64, Node.js LTS ≥ 22.13 (modulul `node:sqlite` este inclus), un browser actual (Chrome, Edge sau Firefox) pe calculatoarele din laborator și din hală. Fără internet la rulare: nu se încarcă fonturi, scripturi sau imagini externe.

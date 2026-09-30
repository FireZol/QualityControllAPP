# Security notes (beta)

Reviewed 2026-09-30 for the pilot. The automated checks are in `app/test/security.test.js`, `app/test/app.test.js` (XSS, CSRF, lockout, roles) and `app/test/stage*.test.js`.

## What is in place
| Area | State |
|------|-------|
| Passwords | scrypt (N=16384), 8+ characters, one-time passwords for new / reset accounts, forced change at first login |
| Login | 5 failed attempts per user name in 15 min lock the account temporarily; unknown user names cost the same time as known ones; every login, failure and block is audited **with the client address** |
| Sessions | random 256-bit token, only its SHA-256 is stored; idle expiry (default 8 h, Settings); a password change closes the other sessions; logout deletes the session |
| Cookies | `HttpOnly`, `SameSite=Strict`; `Secure` when `"secureCookies": true` in `config.json` (set it when HTTPS is put in front) |
| CSRF | every POST needs the session's form token (login has its own); checked before the handler runs |
| Headers | CSP `default-src 'self'` (no inline script or style), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`; pages `no-store` |
| Output | every value goes through the escaping template helper (tested with hostile names); CSV / Excel cells starting with `= + - @` are neutralised |
| Database | parameterised SQL everywhere; dynamic SQL only uses fixed names from code |
| Files | static files cannot leave `app/public`; restore only accepts backup names from the backup folder and first takes a safety copy; uploads do not exist |
| Roles | checked on the server for every route (Personal / Inginer / Administrator); Personal can correct only their own records in the same shift; the production reset is Administrator-only, typed-confirmation, once |
| Audit | who did what, never the password; cannot be edited or deleted in the application |
| Dependencies | none (Node.js built-ins only), so nothing to patch except Node.js itself |
| Requests | 1 MB body limit; Node's default header / request timeouts |

## Known limits — decide before the pilot
1. **Plain HTTP.** Passwords and session cookies cross the network unencrypted. On a closed factory LAN this is a common pilot choice; for anything wider put HTTPS in front (IIS with URL Rewrite, or Caddy / nginx as a reverse proxy with a company certificate, forwarding to `127.0.0.1:8080`), bind the application to `127.0.0.1` (Settings → Network address) and set `"secureCookies": true`.
2. **Lockout can be abused.** Anyone on the network can lock a known user name (including `admin`) for 15 minutes by typing wrong passwords. The audit log shows the client address. A per-address throttle can be added if it happens.
3. **The service runs as SYSTEM** (Scheduled Task). That is more privilege than the application needs. For production use a dedicated local account (for example `svc-ctc`) that has *Modify* rights only on `C:\ROMCAB-CTC\data` and `C:\ROMCAB-CTC\backups` and *Read* on the rest, and register the task for that account.
4. **Backups contain everything** (including password hashes). Give the backup folder the same access list as the server itself; a network share must not be readable by everyone.
5. **Windows firewall:** open TCP 8080 only for the factory subnet.
6. **Database file:** `data\ctc.db` (+ `-wal`, `-shm`) should be readable only by administrators and the service account.
7. **No per-address rate limit and no session limit per user** — fine for tens of users.

## Reporting
Security problems found in the pilot: send them with the page, the time and the user name to the address in Settings → Problem reports; do not post passwords.

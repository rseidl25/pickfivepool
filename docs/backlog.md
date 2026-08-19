# Pick 5 Pool — Backlog (post-launch / deferred)

Features that were considered for the `plan_3.0.md` launch scope but are **not** being built now. Each entry has enough context to pick back up later without re-litigating the decision. This is separate from execution_plan.md's "Still genuinely open" section, which tracks items that never had a spec at all — everything below *does* have a spec, it's just deferred.

## League announcement email

**Status**: descoped from launch, 2026-08-05.

**What it was**: `POST /api/leagues/:id/announce` — owner-only, `{subject, body}`, emails every league member. Originally speced as Nodemailer + Gmail SMTP (a Gmail address + App Password), later discussed swapping to a proper transactional service (e.g. Resend) sending from `pickfivepool.com` since the domain is already on Cloudflare DNS and could add the SPF/DKIM/DMARC records needed to verify it.

**Why deferred**: scrapped for now to keep launch scope smaller — not a technical blocker, just a call to cut it from v1.

**What launch keeps instead**: the league message board (`leagues/{id}/posts/*`) still ships — it covers the "tell the league something" need in-app, just without an email push to inboxes.

**If revisited**: decide Gmail SMTP (zero setup, sender shows as a gmail.com address unless a "Send As" alias is configured) vs. Resend/similar with the `pickfivepool.com` domain (free tier, ~10 min DNS setup in Cloudflare, sends from a real `@pickfivepool.com` address) before resuming `mailer.js`. The route, data flow (owner-only, fan-out to `leagues/{id}/members`), and checkpoint (send to a personal test address, confirm delivery, confirm non-owner rejection) were already speced in the retired `plan_3.0.md` sections — reuse them rather than redesigning from scratch.

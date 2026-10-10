# SFE Hub

Internal SFE / CRM analytics for the field force. Phase 0 = secure empty shell (login, layout, status page).
Stack: Vite + React + TypeScript + Tailwind + Supabase, hosted on GitHub Pages. Full details: `PROJECT_SPEC.md`.

> The repo is **public**. Never commit Excel/CSV files, passwords, or a `secret` / `service_role` key.

## Deploy — click by click

1. **Create the repo:** github.com → **+** → **New repository** → name it (e.g. `sfe-hub`) → **Public** → *Create repository* (leave it empty).
2. **Push the code:** run the commands in your terminal from the project folder (see the end of the chat answer / the `git remote add origin` + `git push` commands GitHub shows on the empty repo page).
3. **Add the two Variables:** repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** tab → **New repository variable**:
   - `VITE_SUPABASE_URL` = `https://rmgqlgirfrqwrcxgeamy.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your Supabase **publishable** key (starts with `sb_publishable_`)
   (Use *Variables*, not *Secrets*. These values are public by design; the real protection is RLS.)
4. **Enable Pages:** repo → **Settings** → **Pages** → **Source: GitHub Actions**.
5. **Run the deploy:** repo → **Actions** → *Deploy to GitHub Pages* → **Run workflow** (it also runs on every push to `main`).
6. **Open the site:** `https://<your-username>.github.io/<repo-name>/` (shown in the finished deploy run).
7. **Log in** with the admin account you created in Supabase (Authentication → Users). That user needs a row in `user_roles` with role `admin`.

The workflow sets `VITE_BASE` to `/<repo-name>/` automatically. For local builds it defaults to `/sfe-hub/`; override with `VITE_BASE`.

### Keep-alive
`Actions` → *Supabase keep-alive* → **Run workflow** to test. It also runs every 3 days so the free Supabase project does not pause.

### Local development
```
copy .env.example .env.local   # then fill in the publishable key
npm install
npm run dev
```

## Troubleshooting
- **Blank page:** Pages source must be *GitHub Actions*; the repo name must match `VITE_BASE` (automatic in CI). Check the Actions run for errors.
- **"Missing configuration" screen:** the two Variables are missing or misspelled. Fix them, then re-run the deploy workflow.
- **Login fails:** check the email/password in Supabase → Authentication → Users; confirm the user is confirmed. Sign-ups are disabled by design.
- **"No role assigned":** the user has no row in `user_roles`. Add one (role `admin`) in the Supabase table editor.
- **Dashboard shows a failed call:** make sure `supabase/01..05*.sql` were all run, and that the key is the *publishable* key.

# BatiPrix: construction material prices and quote requests in Djibouti

A public daily price board (cement, rebar, blocks, sand, roofing sheets…) fed by hardware stores, plus free quote requests for anyone building. Suppliers pay to unlock the contact details of buyers who are ready to purchase.

**Features**
- Public price board: lowest, average and highest price per material, from verified suppliers, updated within the last 45 days
- Per-material page listing every supplier's offer, with a WhatsApp button
- Quote request with no account needed; the buyer's contact stays hidden until a supplier unlocks it
- At most 5 suppliers can unlock each request (makes each lead worth more)
- Supplier dashboard: price editor, request feed, credits, payments
- Admin: verify suppliers, confirm payments, close requests

**Revenue built in**

| Product | Price | Effect |
|---|---|---|
| 10 credits | 5,000 FDJ | 10 buyer contacts (500 FDJ each) |
| 30 credits | 12,000 FDJ | 30 buyer contacts (400 FDJ each) |
| Pro supplier, per month | 20,000 FDJ | Unlimited unlocks, PRO badge, listed first |

New suppliers get 3 free credits.

## Run it

The site is plain HTML/JS with no build step, so it runs on any static host.

```bash
# local preview
python3 -m http.server 8080   # then open http://localhost:8080
```

**Free hosting:** GitHub repo → Settings → Pages → Deploy from branch `main` / root. Netlify or Cloudflare Pages also work (drag and drop the folder).

## Backend (Supabase)

The backend is already live in the Supabase project **djib-ventures** (`xqqgmxtzbuprdjillpof`, Paris region), which `config.js` points to. To recreate it elsewhere, run the files in `supabase/migrations/` in order in the SQL editor of a new project and update `config.js`.

The browser only gets the publishable key. Every rule lives in Postgres: Row Level Security policies, plus triggers that stop users from approving their own content, giving themselves paid features or editing prices.

## Before launch

1. **Payment numbers:** put your real D-Money / Waafi / CAC Pay merchant numbers and WhatsApp in `config.js`.
2. **Make yourself admin:** sign up on the site, then run this in the Supabase SQL editor:
   ```sql
   set session_replication_role = replica;  -- skip the guard trigger for this one admin change
   update public.bati_profiles set is_admin = true
   where id = (select id from auth.users where email = 'you@example.com');
   set session_replication_role = origin;
   ```
   An **Admin** link appears in the menu after you log in again.
3. **Auth emails:** Supabase → Authentication → URL Configuration: set the Site URL to your live domain. For more than a few sign-ups an hour, add your own SMTP server (Brevo and Resend have free plans).
4. **Domain:** buy a `.dj` domain or a cheap `.com` and point it at GitHub Pages.

## How payments work (v1)

The customer sends mobile money, then pastes the transaction reference. You check it on your phone and click **Confirm** in Admin, and the database applies the purchase automatically. This works on day one with no merchant API contract. Once volume justifies it, replace this step with the D-Money or Waafi merchant API.


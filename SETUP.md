# Setting up the Kooskia Opera House website

This is a one-time setup, about 30–45 minutes. After that, your in-laws run everything
from the **Box Office** page (`/admin`) and you shouldn't need to touch it again.

## How it works

| Piece | What it does | Cost |
|---|---|---|
| **Cloudflare Workers** | Hosts the website, the admin page, and the ticket logic | Free plan is plenty |
| **Cloudflare D1** | Small database for shows, showtimes, and orders | Free plan is plenty |
| **Square** | Takes the card payments. The money goes to their existing Square account | Square's normal online card fee per sale |

When someone buys tickets, the site holds their seats for 20 minutes and builds a one-time
Square checkout for exactly what they picked (for example, 2 Premium + 1 Regular for the
Saturday 2 PM show). You don't have to create anything in Square by hand. When they pay,
Square tells the site, and the order goes on the guest list. If they never pay, the seats
are released automatically. The site will never sell more than the seats set for each
showtime (140 max).

---

## 1. Install tools (once)

1. Install **Node.js LTS** from https://nodejs.org (already done on this PC).
2. In this folder, run:
   ```bash
   npm install
   ```

## 2. Create a free Cloudflare account and log in

1. Sign up at https://dash.cloudflare.com/sign-up.
2. Log in from the terminal (opens your browser):
   ```bash
   npx wrangler login
   ```

## 3. Create the database

```bash
npx wrangler d1 create kooskia-opera-house
```
Copy the `database_id` it prints and paste it into `wrangler.jsonc` in place of
`REPLACE_WITH_YOUR_D1_DATABASE_ID`. Then create the tables:
```bash
npm run db:init:remote
```

## 4. Set the admin password

Pick a password for your in-laws. This is what they type at `/admin`.
```bash
npx wrangler secret put ADMIN_PASSWORD
```
To change it later, run the same command again. Changing it signs everyone out.

## 5. Connect Square

1. Go to https://developer.squareup.com, sign in with **their** Square account, and click
   **Create an application** (name it "Opera House Website").
2. **Test first (recommended):** open the app's **Sandbox** tab and copy the
   *Sandbox Access token*. Under **Locations**, copy the sandbox *Location ID*. In
   `wrangler.jsonc`, set `"SQUARE_ENVIRONMENT": "sandbox"`.
3. **Going live:** switch to the **Production** tab, copy the *Production Access token*
   and the Location ID of the opera house location. Set `"SQUARE_ENVIRONMENT": "production"`.
4. Save them as secrets:
   ```bash
   npx wrangler secret put SQUARE_ACCESS_TOKEN
   ```
   ```bash
   npx wrangler secret put SQUARE_LOCATION_ID
   ```
5. **Webhook** (tells the site when a payment goes through):
   - In the Square app, open **Webhooks → Subscriptions → Add subscription**.
   - URL: `https://YOUR-SITE/api/square/webhook` (use the real address from step 6 or 7).
   - Events: check **payment.created** and **payment.updated**.
   - Save, then copy the **Signature key** and run:
     ```bash
     npx wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
     ```
   - If you later change the site's address, update the webhook URL in Square too.

   The site also double-checks with Square when a buyer lands on the confirmation page,
   and every 5 minutes for unfinished orders. A missed webhook won't lose a sale.

## 6. Publish

```bash
npm run deploy
```
It prints your address, something like `https://kooskia-opera-house.<you>.workers.dev`.
Open it, go to `/admin`, sign in, and add the first show.

**Do a test purchase in sandbox mode** with Square's test card `4111 1111 1111 1111`
(any future date, any CVV, any ZIP). Check that the order appears on the guest list.
Then switch to production (step 5.3), re-run `npm run deploy`, and you're live.

## 7. Use their own web address (optional)

If they have a domain (for example `kooskiaoperahouse.com`):
Cloudflare dashboard → **Workers & Pages → kooskia-opera-house → Settings → Domains & Routes
→ Add → Custom domain**. Cloudflare walks you through it. If the domain is registered
elsewhere, it will ask you to point the domain's nameservers to Cloudflare.

## 8. Automatic deploys from GitHub (optional)

Cloudflare dashboard → your Worker → **Settings → Build → Connect** to the GitHub repo.
After that, every push to `main` redeploys the site. This only matters if you change the
code. Show and showtime changes happen in the admin page and need no deploy.

---

## Trying it on your own computer

```bash
cp .dev.vars.example .dev.vars
```
```bash
npm run db:init:local
```
```bash
npm run db:demo:local
```
```bash
npm run dev
```
Open http://localhost:8787 (admin: http://localhost:8787/admin, password `change-me`).
With `DEMO_PAYMENTS=true` and no Square keys, checkout is simulated.

## Settings you can change in `wrangler.jsonc`

| Setting | Default | Meaning |
|---|---|---|
| `MAX_SEATS_PER_SHOW` | 140 | Hall capacity. Premium + Regular can't exceed this |
| `MAX_TICKETS_PER_ORDER` | 20 | Biggest single online order |
| `HOLD_MINUTES` | 20 | How long seats are held while someone pays |
| `TIMEZONE` | America/Los_Angeles | Kooskia is on Pacific time. Sales close at showtime |
| `DEMO_PAYMENTS` | false | Never set to true on the live site |

Run `npm run deploy` after changing any of these.

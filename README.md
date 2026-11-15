# Kooskia Opera House

**Website, online ticketing, and box-office admin for the historic Kooskia Opera House in Kooskia, Idaho.**

[![Cloudflare Workers](https://img.shields.io/badge/hosted%20on-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/database-Cloudflare%20D1-F38020?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Square](https://img.shields.io/badge/payments-Square-3E4348?logo=square&logoColor=white)](https://developer.squareup.com/)
[![No framework](https://img.shields.io/badge/frontend-plain%20HTML%2FCSS%2FJS-4B8BBE)](#tech-stack)

**Live site:** https://kooskia-opera-house.kooskia.workers.dev

---

## Overview

This project replaces the opera house's old static website with a single, low-cost
system that covers everything the theatre needs:

- A **public website** with the theatre's history, visitor information, and current shows
- **Online ticket sales** with Premium and Regular seating, paid through the theatre's own Square account
- A password-protected **Box Office** admin page where volunteers add shows, manage
  showtimes, print guest lists, and record door or phone sales, with no code or manual edits needed

The whole site runs on Cloudflare's free tier. The only ongoing cost is Square's standard
card-processing fee on each sale.

## Features

### For guests
- Browse upcoming shows and pick a showtime
- Choose Premium or Regular seats and check out securely through Square
- Order confirmation page with an order number (for example `KOH-7F3K9Q2M`)
- Sold-out and cancelled showtimes are clearly marked and can't be selected

### For box-office staff
- Add and edit shows with a name, tagline, description, poster photo, prices, and seat counts
- Add any number of showtimes per show; pause online sales or cancel a single performance
- **Guest list** for every showtime: search, print, download as a spreadsheet, and check guests in at the door
- Record box-office sales and complimentary tickets so the seats come off the website immediately
- Cancel orders to release seats (refunds are issued in the Square Dashboard)

### Reliability and safety
- **No overselling:** seats are reserved with a single SQL statement that checks capacity,
  so simultaneous buyers can never exceed the limit (verified with 10 concurrent buyers
  competing for the last 100 seats)
- **Seat holds:** unpaid orders hold seats for 20 minutes, then a scheduled job releases them
  and deletes their payment links
- **Payment confirmation from three sources:** a signature-verified Square webhook, a check when the
  buyer lands on the confirmation page, and a 5-minute background check, so a missed webhook never loses a sale
- **Protected records:** shows with ticket sales can't be deleted from the admin, only hidden
- Admin sessions use signed, `HttpOnly`, `Secure`, `SameSite=Strict` cookies, and admin
  write requests reject cross-site origins

## Tech stack

| Layer      | Technology |
|------------|------------|
| Hosting    | [Cloudflare Workers](https://developers.cloudflare.com/workers/) with static assets |
| Database   | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite) |
| Payments   | [Square](https://developer.squareup.com/) Payment Links + Webhooks |
| Frontend   | Plain HTML, CSS, and JavaScript, with no build step |
| Tooling    | [Wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI, Node.js |

## Project structure

```
.
├── public/                  Static site, served as-is
│   ├── index.html           Home page
│   ├── shows.html           Upcoming shows
│   ├── tickets.html         Seat selection and checkout
│   ├── confirmation.html    Order confirmation
│   ├── about.html           History of the opera house
│   ├── visit.html           Directions and visitor info
│   ├── 404.html
│   ├── admin/               Box Office app (index.html, admin.js, admin.css)
│   ├── css/  js/  images/
├── src/worker.js            API: shows, checkout, Square integration, admin, scheduled jobs
├── schema.sql               Database tables
├── scripts/demo-data.sql    Sample show for local testing
├── wrangler.jsonc           Cloudflare configuration and settings
├── SETUP.md                 One-time setup and deployment guide
└── ADMIN-GUIDE.md           Plain-English guide for box-office staff
```

## How it works

1. A guest picks a showtime and seat counts on `tickets.html`.
2. `POST /api/checkout` atomically reserves the seats as a **pending** order and creates a
   one-time Square payment link for that exact cart.
3. The guest pays on Square's hosted checkout page.
4. Square calls `POST /api/square/webhook`. The worker verifies the signature and marks the order **paid**.
5. Orders that are never paid expire after `HOLD_MINUTES`, and their seats return to sale.

### API

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/shows`, `/api/shows/:id` | Published shows with live seat availability |
| `POST` | `/api/checkout` | Reserve seats and create a Square payment link |
| `GET`  | `/api/orders/:id` | Public order status for the confirmation page |
| `GET`  | `/api/images/:id` | Show poster images |
| `POST` | `/api/square/webhook` | Square payment notifications (signature-verified) |
| `POST` | `/api/admin/login`, `/api/admin/logout` | Box Office sign-in |
| `GET/POST/PUT/DELETE` | `/api/admin/shows[/:id]` | Manage shows and showtimes |
| `GET/POST` | `/api/admin/performances/:id/orders` | Guest list and box-office sales |
| `PATCH` | `/api/admin/orders/:id` | Check in or cancel an order |
| `POST` | `/api/admin/images` | Upload a poster |

## Getting started

### Prerequisites
- [Node.js](https://nodejs.org/) LTS
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account
- A [Square](https://developer.squareup.com/) developer application (only needed for real payments)

### Run locally

```bash
npm install
cp .dev.vars.example .dev.vars     # local secrets; demo payments are on by default
npm run db:init:local              # create the local database
npm run db:demo:local              # optional: add a sample show
npm run dev                        # http://localhost:8787
```

Open `http://localhost:8787/admin` and sign in with the `ADMIN_PASSWORD` from `.dev.vars`.
With `DEMO_PAYMENTS=true`, checkout runs end to end without contacting Square.

### Deploy

See **[SETUP.md](SETUP.md)** for the full walkthrough. In short:

```bash
npx wrangler login
npx wrangler d1 create kooskia-opera-house    # put the database_id in wrangler.jsonc
npm run db:init:remote
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SQUARE_ACCESS_TOKEN
npx wrangler secret put SQUARE_LOCATION_ID
npx wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
npm run deploy
```

## Configuration

Non-secret settings live in `wrangler.jsonc` under `vars`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_SEATS_PER_SHOW` | `140` | Building capacity; Premium + Regular seats can't exceed this |
| `MAX_TICKETS_PER_ORDER` | `20` | Largest single online order |
| `HOLD_MINUTES` | `20` | How long unpaid seats are held |
| `TIMEZONE` | `America/Los_Angeles` | Theatre's local time zone |
| `SQUARE_ENVIRONMENT` | `production` | `sandbox` for testing, `production` for real payments |
| `DEMO_PAYMENTS` | `false` | Skip Square entirely (local testing only) |

Secrets are **never committed**. Set them with `npx wrangler secret put <NAME>`:

| Secret | Description |
|--------|-------------|
| `ADMIN_PASSWORD` | Box Office password (changing it signs everyone out) |
| `SQUARE_ACCESS_TOKEN` | Square application access token |
| `SQUARE_LOCATION_ID` | Square location that receives payments |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Verifies incoming Square webhooks |

## Documentation

- **[SETUP.md](SETUP.md)**: one-time Cloudflare and Square setup, deployment, and custom domains
- **[ADMIN-GUIDE.md](ADMIN-GUIDE.md)**: day-to-day guide for box-office volunteers

## Data and backups

All shows, showtimes, and orders are stored in Cloudflare D1, not on any personal computer.
To export a backup of the live database:

```bash
npx wrangler d1 export kooskia-opera-house --remote --output=backup.sql
```

---

*Built for the Kooskia Opera House, Kooskia, Idaho.*

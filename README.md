# YardBook

A simple job-and-payment tracker built for a small landscaping crew (this one: two brothers, ~50 regular mowing customers, one commercial contract).

## What it does

- **Customers** — keep contact info, service frequency (weekly/biweekly/monthly/one-time), rate, and notes for every residential customer and the commercial contract.
- **Schedule** — recurring mowing visits are generated automatically based on each customer's frequency and preferred day, several weeks out. Mark a visit done or skipped right from the schedule.
- **Collections** — every completed-but-unpaid visit shows up here, grouped by customer, sorted oldest-first, with a running total. One tap to call or text a payment reminder (pre-filled with your Venmo/Zelle/Cash App info from Settings), one tap to mark paid.
- **Dashboard** — today's jobs, this week's jobs, and total money owed at a glance.
- **Settings** — business name, payment handles, and an editable reminder message template. Data can be exported as a JSON backup at any time.

All data is stored locally in the browser (`localStorage`) — nothing leaves the device. Add the page to your phone's home screen (Safari/Chrome "Add to Home Screen") for an app-like experience.

## Development

```sh
npm install
npm run dev      # start local dev server
npm run build    # typecheck + production build
```

Built with React, TypeScript, Vite, Tailwind CSS, and react-router.

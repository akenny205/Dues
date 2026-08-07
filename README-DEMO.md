# Demo mode

For recording a walkthrough without touching the real database (or needing
Supabase credentials at all).

```
npm run dev:demo
```

Then open `http://localhost:3000`. You're already "logged in" as **Alex
Chen** — no login screen, no sign-up flow. Everything is served from an
in-memory fake dataset instead of the network; nothing you do in demo mode
touches your real Supabase project.

## What's seeded

Two groups, from Alex's point of view:

- **Apartment 4B** (Alex owns it) — 4 members, 8 sessions covering the
  regular flows:
  - A few ordinary closed sessions with different payers (Costco run,
    electric bill, internet bill).
  - A settle-up payment (Jordan → Alex).
  - A **live session** in progress ("Weekend groceries") — only some
    members have added their amount yet.
  - A session with a **pending edit that needs your approval** ("Gas
    bill") — shows up in the Dues tab's Pending Approval panel and the
    Sessions tab.
  - A session where **you're the editor waiting on someone else**
    ("Streaming subscriptions").
  - A session where **your edit got rejected** ("Cleaning supplies") —
    shows up under Notifications.
  - A **pending join request** (Taylor Kim) waiting on you as owner — see
    the Members tab.
- **Cabin Trip** (Casey owns it, Alex is just a member) — a couple of
  simple, fully-settled sessions, so the group list isn't empty and you
  have a second group to click into.

Balances, badges, and notifications all fall out of that data the same way
they would with real rows — nothing about the UI is hardcoded to demo mode.

## Switching who you're logged in as

Every seeded person is a real demo account — useful for reviewing/approving
an edit from the other side. Log out (button's on the Home page header),
go to `/login`, and sign in with any of these emails — **any password
works**, it's never actually checked:

| Email | Name | Notes |
|---|---|---|
| `alex@demo.dues.app` | Alex Chen | Default — owns Apartment 4B |
| `jordan@demo.dues.app` | Jordan Rivera | Has a pending review on "Gas bill"; also owes a review on "Streaming subscriptions" |
| `sam@demo.dues.app` | Sam Patel | Also has a pending review on "Gas bill" |
| `morgan@demo.dues.app` | Morgan Lee | Proposed the "Gas bill" edit — waiting on Alex/Jordan/Sam |
| `taylor@demo.dues.app` | Taylor Kim | Not in a group yet — has a pending request to join Apartment 4B |
| `casey@demo.dues.app` | Casey Nguyen | Owns Cabin Trip |
| `riley@demo.dues.app` | Riley Brooks | Cabin Trip member |

## Everything you do actually works

Creating a session, editing one, approving/rejecting, joining, removing a
member — all of it mutates the in-memory data for the rest of that session,
exactly like the real app. Refreshing the page resets everything back to
the seed data above, since none of it is persisted anywhere.

## Editing the seed data

It's all in `src/lib/mockData.ts` — plain arrays, easy to add a session,
rename someone, or change a dollar amount before recording.

## Turning it off

Demo mode is only active when `NEXT_PUBLIC_DEMO_MODE=true` is set — `npm run
dev` (no `:demo`) runs against your real Supabase project exactly as
before. Nothing about the default dev/build/deploy path changed.

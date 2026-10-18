# TicketHub — System Design

**Author:** Keith
**Date:** Day 8 (revision)

---

## 1. Requirements

### 1.1 Functional

| # | Requirement |
|---|---|
| F1 | Browse and search events by city, date, genre |
| F2 | View an event and its seat map with live availability |
| F3 | Hold seats for 5 minutes while the user completes checkout |
| F4 | Pay for a hold and receive a confirmed order + tickets |
| F5 | View my orders and tickets |
| F6 | Register / log in |
| F7 | (Admin) Create venues, events, and per-event seat inventory |

### 1.2 Non-functional

**Correctness — the priority**
- **N1 — No double-booking.** A seat may belong to at most one confirmed order, under
  any concurrency, retry, or partial failure. We prefer to fail a request than to sell
  a seat twice.
- **N2 — Exactly-once payment.** Double-clicks, retries, and dropped connections must
  not produce two charges or two orders.
- **N3 — No lost orders.** An order is durably committed before the user sees
  "confirmed".
- **N4 — Holds always resolve.** Every hold becomes an order or is released within
  5 minutes; no seat is stranded.

**Speed**
- **N5** Event list/detail p95 < 200 ms, p99 < 500 ms.
- **N6** Seat map p95 < 300 ms normally, < 800 ms during a drop. A slightly stale map
  is acceptable because the hold re-validates.
- **N7** Hold request p95 < 500 ms — the request users are most anxious about.
- **N8** Sustain ~25 req/s normally; survive a ~20,000 req/s burst on a major on-sale.

**Fairness**
- **N9** Admission in arrival order via a waiting room, not by connection speed.
- **N10** Max 6 seats per event per user, enforced server-side.
- **N11** Bot resistance: rate limits per IP/account, WAF rules. Refreshing faster
  gives no advantage — queue position decides, not request rate.
- **N12** Seat-map updates are pushed to all admitted users simultaneously, so nobody
  gets a head start by polling harder.

**Other:** 99.9% availability for browsing (N13); stateless, horizontally scalable app
tier (N14); TLS, hashed passwords, no card data on our servers (N15); daily backups +
PITR (N16).

---

## 2. Estimates

### 2.1 Normal traffic
50,000 visitors × 10 pages = **500,000 page views/day**; **5,000 tickets/day**;
**2,000,000 registered users**.

| Metric | Calculation | Value |
|---|---|---|
| Average page views/s | 500,000 / 86,400 | **~6 req/s** |
| Evening peak | ~4× average | **~23 req/s** |
| Orders/s | 5,000 / 86,400 / 2.5 seats | ~0.02 |
| Seats sold/s (peak) | 5,000 × 0.4 over 4 h | ~0.14 |
| Read:write ratio | ~250 : 1 | |

**Storage, year 1:** users ~4 GB; 10,000 events × 3,000 seats = 30M `event_seats`
rows ≈ 6 GB; 1.8M orders ≈ 1.8 GB. **Total ≈ 13 GB/year** — trivial for one Postgres
primary. *The hard problem here is concurrency, not volume.*

### 2.2 The big sale
**200,000 people, 20,000 seats, first 10 minutes.**

| Metric | Calculation | Value |
|---|---|---|
| Arrival rate | 200,000 / 600 s | **~333 users/s** |
| Purchase attempts/s | 200,000 / 600 s | **~333/s** |
| Requests per session | ~6 (event, map, hold, pay, confirm) | |
| Average request rate | 200,000 × 6 / 600 | **~2,000 req/s** |
| Burst at t=0 | ~10× average | **~20,000 req/s** |
| Seat-map polling | 50,000 users × 1 poll / 5 s | **~10,000 req/s** |
| Seats sold | 20,000 in ~120 s | **~167 seats/s** |
| Orders/s | 20,000 / 2.5 seats over 120 s | **~67/s** |

### 2.3 Comparison

| Dimension | Normal peak | Big sale | Ratio |
|---|---|---|---|
| Request rate | 23 req/s | 20,000 req/s | **~870×** |
| Purchase attempts | 0.02/s | 333/s | **~16,000×** |
| Seat writes | 0.14/s | 167/s | ~1,200× |
| Concurrent users | ~2,000 | 50,000–200,000 | ~50–100× |
| Duration | all day | ~2 min of real work | |

**Conclusion: two different things break, needing two different fixes.**

1. **Read amplification.** 10,000 req/s of the *same* seat map is a caching and push
   problem, not a database problem. → CDN + Redis, plus WebSocket push to kill polling.
2. **Write contention.** 167 seat-writes/s concentrated on one event's 20,000 rows is
   where double-booking bugs live. → atomic conditional updates + a unique constraint
   as backstop (§5).

Everything else in the architecture exists to convert the 870× burst into load the
backend can actually serve. The design must autoscale from ~2 to ~100 app instances in
under three minutes, which is only possible because the app tier is stateless.

---

## 3. API

REST/JSON over HTTPS, `Authorization: Bearer <JWT>`, cursor pagination. Every mutating
endpoint accepts `Idempotency-Key`.

**Browse events**
```
GET /v1/events?city=lisbon&from=2025-06-01&q=rock&limit=20&cursor=abc
200 { "items": [{ "id": "evt_123", "title": "...", "starts_at": "...",
                  "min_price_cents": 3500, "seats_available": 4210 }],
      "next_cursor": "def" }
```

**Event detail**
```
GET /v1/events/{event_id}
200 { ...venue, sections, on_sale_at, max_seats_per_user... }
```

**Seat map** (advisory — the hold is the authority)
```
GET /v1/events/{event_id}/seats?section=A
200 { "as_of": "2025-06-14T19:58:02Z",
      "sections": [{ "id": "A", "rows": [{ "row": "1", "seats": [
        { "seat_id": "seat_991", "number": 1, "status": "available", "price_cents": 4500 },
        { "seat_id": "seat_992", "number": 2, "status": "held",      "price_cents": 4500 },
        { "seat_id": "seat_993", "number": 3, "status": "sold",      "price_cents": 4500 }
      ]}]}]}
```

**Hold seats** — all-or-nothing
```
POST /v1/holds
Idempotency-Key: 7f3c...
{ "event_id": "evt_123", "seat_ids": ["seat_991", "seat_994"] }

201 { "hold_id": "hld_555", "expires_at": "2025-06-14T20:03:02Z",
      "total_cents": 9000 }
409 { "error": "seats_unavailable", "unavailable": ["seat_994"] }
```
Also returns `429` if the user already holds ≥6 seats for this event (N10).

```
DELETE /v1/holds/{hold_id}   → 204   (abandon checkout, seats freed immediately)
```

**Pay**
```
POST /v1/orders
Idempotency-Key: 7f3c...            ← same key as the hold
{ "hold_id": "hld_555", "payment_method_id": "pm_visa_4242" }

201 { "order_id": "ord_777", "status": "confirmed", "total_cents": 9000,
      "tickets": [{ "id": "tkt_1", "seat_id": "seat_991", "qr": "..." }] }
402 { "error": "card_declined" }    ← hold released
410 { "error": "hold_expired" }
```

**My orders / tickets**
```
GET /v1/me/orders?status=upcoming
GET /v1/me/tickets/{ticket_id}      → ticket + signed QR + PDF link
```

**Live seat updates (replaces polling)**
```
WS /v1/events/{event_id}/stream
← { "type": "seats_changed",
    "changes": [{ "seat_id": "seat_994", "status": "sold" }] }
```

**Waiting room**
```
GET /v1/waiting-room/status → { "position": 4211, "eta_seconds": 90, "admitted": false }
```

---

## 4. Data model

Physical seats belong to a **venue** and are reused across dates; **per-event
inventory** lives in `event_seats`, keyed by `(event_id, seat_id)`. This lets a venue
host many dates without ever mutating the physical seat record or corrupting the
history of a past event's seating.

```
venues ──< seats            (physical seat: section, row, number)
   │
   └──< events ──< event_seats >── seats
                        │
                        ├──< holds
                        └──< order_items >── orders ──< users
                                                  │
                                            order_items ──< tickets
```

### `users`
`id` uuid PK · `email` citext UNIQUE NOT NULL · `password_hash` text (argon2id) ·
`display_name` text · `created_at` timestamptz

### `venues`
`id` uuid PK · `name` text · `city` text · `timezone` text

### `seats` — physical seat
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| venue_id | uuid FK → venues NOT NULL | |
| section | text NOT NULL | |
| row_label | text NOT NULL | |
| seat_number | int NOT NULL | |

`UNIQUE (venue_id, section, row_label, seat_number)` — a seat exists once per venue,
forever, regardless of how many events are held there.

### `events`
`id` uuid PK · `venue_id` uuid FK · `title` text · `starts_at` timestamptz ·
`on_sale_at` timestamptz · `status` enum(draft, on_sale, sold_out, cancelled) ·
`max_seats_per_user` int DEFAULT 6

Index: `(status, starts_at)`, `(on_sale_at)`.

### `event_seats` — per-event inventory ⭐
| column | type | notes |
|---|---|---|
| **event_id** | uuid FK → events | **composite PK part 1** |
| **seat_id** | uuid FK → seats | **composite PK part 2** |
| price_cents | int NOT NULL | price for *this* event |
| status | enum(available, held, sold, blocked) DEFAULT 'available' | |
| hold_id | uuid FK → holds NULL | |
| hold_expires_at | timestamptz NULL | created_at + 5 min |
| order_item_id | uuid FK → order_items NULL | |
| version | int DEFAULT 0 | optimistic-lock counter |

```sql
PRIMARY KEY (event_id, seat_id)
CHECK (status <> 'sold' OR order_item_id IS NOT NULL)
CHECK (status <> 'held' OR hold_id IS NOT NULL)
```
Index: `(event_id, status)` — the seat map becomes a cheap index scan.

**Why the composite key matters:** the same physical seat is `available` for Friday's
show and `sold` for Saturday's. Keying on `(event_id, seat_id)` means inventory is
scoped per event by construction — there is no way to accidentally write Saturday's
sale onto Friday's row, and historical events keep their exact seat records even if
the venue is reconfigured later.

### `holds`
`id` uuid PK · `user_id` uuid FK · `event_id` uuid FK · `expires_at` timestamptz NOT
NULL (created_at + 5 min) · `status` enum(active, converted, expired, released) ·
`idempotency_key` text UNIQUE · `created_at` timestamptz

### `orders`
`id` uuid PK · `user_id` uuid FK · `hold_id` uuid FK UNIQUE · `status`
enum(pending, confirmed, cancelled, refunded) · `total_cents` int ·
`payment_intent_id` text · `idempotency_key` text UNIQUE · `created_at` timestamptz

`hold_id UNIQUE` — one hold produces at most one order. `idempotency_key UNIQUE` —
replaying a request returns the stored response instead of charging again (N2).

### `order_items`
`id` uuid PK · `order_id` uuid FK NOT NULL · `seat_id` uuid FK NOT NULL ·
`event_id` uuid FK NOT NULL · `price_cents` int · `status` enum(active, cancelled)

```sql
CREATE UNIQUE INDEX one_live_order_per_event_seat
  ON order_items (event_id, seat_id) WHERE status <> 'cancelled';
```
**The backstop.** Even if a code path is wrong, this index makes an oversell a
`23505` error rather than a broken customer.

### `tickets`
`id` uuid PK · `order_item_id` uuid FK UNIQUE NOT NULL · `qr_secret` text ·
`issued_at` timestamptz

**Relationships in one line:** one user → many orders → many order_items → one
`event_seats` row each. One hold → at most one order. One order_item → one ticket.

---

## 5. How double-booking is prevented

Four independent layers. Any single one failing does not produce an oversell.

### Layer 1 — The reservation is one atomic conditional UPDATE

The hold never does read-then-write in application code. It is a single statement whose
`WHERE` clause is the decision:

```sql
BEGIN;  -- READ COMMITTED (Postgres default) is sufficient here

-- Serialize this user's own concurrent holds, so the 6-seat limit can't be raced.
SELECT id FROM users WHERE id = $user_id FOR UPDATE;

-- Claim exactly the seats that are still available.
WITH claimed AS (
  UPDATE event_seats
     SET status          = 'held',
         hold_id         = $hold_id,
         hold_expires_at = now() + interval '5 minutes',
         version         = version + 1
   WHERE event_id = $event_id
     AND seat_id  = ANY($seat_ids::uuid[])
     AND status   = 'available'
  RETURNING seat_id
)
SELECT seat_id FROM claimed;

-- App: if count(claimed) <> count(requested) → ROLLBACK, respond 409.
--      Also check the user's live seat count for this event ≤ 6 here.
COMMIT;
```

**Why two users cannot both get `seat_994`.** Postgres takes a row lock on every row an
`UPDATE` touches. The first transaction locks `seat_994` and flips it to `held`. The
second transaction blocks on that lock; when the first commits, Postgres re-evaluates
the `WHERE` clause against the *new* row version (EvalPlanQual) rather than the stale
snapshot. It now sees `status = 'held'`, so the row **drops out of its result set**. Its
`RETURNING` count comes back short, the application rolls back, and the user gets
`409 seats_unavailable` with the specific missing seats.

The database serializes the decision, not the application. There is no window between a
read and a write for another request to slip through.

The `SELECT ... FOR UPDATE` on the user row is the same trick applied to the seat
*limit*: it prevents one user's two parallel requests from each buying 6 seats.

### Layer 2 — The unique index as a hard stop

If any code path ever forgot the `WHERE status = 'available'`, or a retried worker
replayed an insert, the partial unique index on `(event_id, seat_id)` from §4 refuses
to commit. A bug becomes a failed request instead of a double sale. This is the layer
that makes the guarantee independent of application correctness.

### Layer 3 — Hold expiry that cannot steal a sold seat

A worker releases stale holds every 15 seconds:

```sql
UPDATE event_seats
   SET status = 'available', hold_id = NULL, hold_expires_at = NULL
 WHERE status = 'held' AND hold_expires_at < now();
```

This is *also* conditional. If the user paid at 4:59, the order transaction has already
flipped the row to `sold`, so `WHERE status = 'held'` matches nothing and the reaper
leaves it alone. Reaper and payment can never fight over the same row — whichever
commits first moves the row out of the other's predicate.

### Layer 4 — Payment happens only after the seat is secured

The flow is **claim → charge → confirm**. The card is never charged for a seat we do
not already hold. If payment fails, the confirming transaction rolls back and the hold
is released: the user loses the seat, but nobody gets an oversell.

`POST /v1/orders` reuses the hold's `Idempotency-Key`. If the network drops after the
charge and the client retries, the server returns the original response — no second
charge, no second order (N2).

### Why this holds at 167 seat-writes/s

Row-level locking means contention is **per seat**, not per event: 20,000 seats are
20,000 independent locks, so 100 concurrent holds for different seats proceed in
parallel. The ~67 orders/s of writes are far inside one Postgres primary's capacity.
What the primary *cannot* do is 10,000 seat-map reads/s — which is why those are served
from Redis and pushed over WebSocket (§6).

---

## 6. Architecture

```
                       ┌──────────────────────────────┐
 2M users              │             CDN              │
 200k on drop day ────▶│ static assets, event pages,  │
                       │ cached seat maps (30 s TTL)  │
                       └───────────────┬──────────────┘
                                       │ cache misses / API
                       ┌───────────────▼──────────────┐
                       │         WAF + LB             │
                       │ TLS, bot rules, IP rate lim. │
                       └───────────────┬──────────────┘
                       ┌───────────────▼──────────────┐
                       │        WAITING ROOM          │
                       │ token bucket, signed         │
                       │ admission cookie, FIFO       │
                       └───────────────┬──────────────┘
                            admitted (≈2,000 req/s)
                       ┌───────────────▼──────────────┐
                       │         API GATEWAY          │
                       │ JWT auth, routing, per-user  │
                       │ quotas                       │
                       └───────────────┬──────────────┘
        ┌──────────────┬───────────────┼────────────────┬──────────────┐
 ┌──────▼──────┐ ┌─────▼──────┐ ┌──────▼───────┐ ┌──────▼──────┐ ┌─────▼──────┐
 │ Event       │ │ Seat &     │ │ Order &      │ │ Realtime    │ │ (Admin)    │
 │ Catalog     │ │ Hold       │ │ Payment      │ │ Gateway     │ │ Event mgmt │
 │ stateless   │ │ stateless  │ │ stateless    │ │ WS, stateless│ │            │
 └──────┬──────┘ └─────┬──────┘ └──────┬───────┘ └──────┬──────┘ └─────┬──────┘
        └──────────────┴───────────────┼────────────────┴──────────────┘
                                       │
                       ┌───────────────▼──────────────┐
                       │            REDIS             │
                       │ event/seat-map cache         │
                       │ rate-limit counters          │
                       │ waiting-room queue           │
                       │ pub/sub for seat deltas      │
                       └───────────────┬──────────────┘
                       ┌───────────────▼──────────────┐
                       │       POSTGRES PRIMARY       │
                       │ users, events, event_seats,  │
                       │ holds, orders, order_items   │
                       │ ── sole write authority ──   │
                       └───────────────┬──────────────┘
                    ┌──────────────────┴──────────────────┐
          ┌─────────▼─────────┐                ┌──────────▼─────────┐
          │   Read replicas   │                │   Queue (SQS)      │
          │ catalog + lists   │                └──────────┬─────────┘
          └───────────────────┘                           │
                                            ┌─────────────▼─────────────┐
                                            │         WORKERS           │
                                            │ · hold expiry reaper      │
                                            │ · payment settlement      │
                                            │ · ticket + QR, email      │
                                            └─────────────┬─────────────┘
                                            ┌─────────────▼─────────────┐
                                            │ Object storage (PDFs)     │
                                            └───────────────────────────┘
```

### Components

| Component | Responsibility | Why it exists |
|---|---|---|
| **CDN** | Static assets, event pages, 30 s seat-map snapshots | Absorbs most read traffic; the 10,000 req/s of map views never reach origin |
| **WAF + LB** | TLS, bot detection, IP rate limits, balancing | First line of fairness (N11); scrapers blocked before they cost anything |
| **Waiting room** | Token bucket admitting users at a fixed rate, signed cookie | Converts an unbounded 20,000 req/s spike into ~2,000 req/s the backend can serve |
| **API gateway** | JWT validation, routing, per-user quotas | One place for auth and abuse limits |
| **Event Catalog** | Read-only event/venue queries off replicas + cache | Pure read path; stays up and fast even while writes are throttled |
| **Seat & Hold** | The atomic claim, hold TTL, release | Owns the one operation that must be strongly consistent |
| **Order & Payment** | Order creation, provider call, seat confirmation | Isolates the slow, flaky external dependency from the claim path |
| **Realtime Gateway** | WebSocket fan-out of seat deltas via Redis pub/sub | Removes ~10,000 req/s of polling — the single biggest read saving |
| **Redis** | Cache, counters, queue, pub/sub | Hot data in sub-ms; **never** the source of truth for seat ownership |
| **Postgres primary** | System of record | The only component allowed to decide who owns a seat |
| **Read replicas** | Catalog and listings | Keeps read load off the primary during the drop |
| **Queue + workers** | Hold expiry, settlement, ticket generation, email | Moves slow retryable work off the request path |
| **Object storage** | Ticket PDFs | Durable, cheap, served via CDN |

### The handoff: waiting room → reservation transaction

This is the part that must be airtight, so it is spelled out end to end.

1. **t = 0.** 200,000 clients refresh. The CDN answers all assets and the cached event
   page; origin sees a fraction.
2. **The waiting room issues each arrival a monotonic ticket** and stores it in a Redis
   sorted set keyed by event. A user gets `position` and `eta_seconds`. Refreshing does
   **not** re-enqueue them — the ticket is bound to their session cookie, so spamming
   refresh cannot improve their place (N9, N11).
3. **The room admits at a controlled rate** (~2,000 req/s), handing each admitted user a
   short-lived **signed admission cookie**. The API gateway rejects any request without
   a valid admission cookie for that event — so even if someone bypasses the queue UI
   or scripts the API directly, the gateway will not let the request reach the seat
   service. *The queue is not advisory; it is enforced at the edge.*
4. **Admitted users load the seat map** from CDN/Redis (possibly a few hundred ms
   stale) and open a WebSocket for deltas.
5. **`POST /v1/holds` runs the §5 transaction.** Winners get `201`; losers get `409`
   with the specific seats to avoid, and immediately re-select. Admission rate is tuned
   to roughly the rate the seat service can absorb, so hold requests queue briefly in
   Postgres rather than timing out — a small, controlled queue instead of a cliff.
6. **`POST /v1/orders`** charges and confirms. Payment calls run on a separately scaled
   pool so a slow provider never backpressures the seat claim.
7. **Sold out in ~2 minutes.** The queue drains, autoscaling returns to baseline,
   workers catch up on email and ticket PDFs asynchronously.

**Degradation.** If Redis dies, we fall back to the database and get slower but still
correct. If a payment worker dies, the idempotency key makes the retry safe. If the
primary fails over, in-flight holds return `503` and users retry. In every case **no
seat is sold twice** — inconvenience is acceptable, an oversell is not.

---

## 7. Trade-offs

### T1 — Strong consistency on writes, eventual consistency on seat-map reads

**Choice.** Seat maps and listings are cached with a 30 s TTL and may be stale; the
hold is authoritative.

**Why.** Serving every map read from the primary would mean 10,000 queries/s against
one event's 20,000 rows. It would fall over, and users would get errors instead of
slightly stale maps. Because the hold re-validates, staleness costs at most one retry.

**Cost.** A user can click a seat that looks free and get a `409`. That is a genuine
UX regression and the most likely complaint during a hot sale. **Mitigation:** WebSocket
deltas keep maps fresh in practice (sub-second), and the UI pre-selects alternatives.

**Rejected alternative.** `SELECT ... FOR UPDATE` on map reads is correct but serializes
the entire read path — impossible at 10,000 req/s.

### T2 — A waiting room: fairness and availability at the cost of conversion

**Choice.** During a drop we queue users instead of serving everyone immediately.

**Why.** 200,000 buyers for 20,000 seats cannot all be served. Without a queue the
system either collapses (everyone loses) or degenerates into a race won by the fastest
connection and the best bot — unfair (N9, N11) and a direct subsidy to scalpers.

**Cost.** A worse experience for the majority: most queued users leave without buying,
some are annoyed, and even users who *would* have succeeded wait longer. The queue is
also a stateful component that must itself be highly available — if it breaks, the sale
is blocked.

**Why we still chose it.** A slow, fair, working site beats a fast, unfair, crashed one.
The queue is also the only thing that bounds load, which is what lets the rest of the
architecture stay simple.

### T3 — One Postgres primary as the sole write authority

**Choice.** All seat-ownership decisions go through a single primary. Redis is a cache,
never the authority.

**Why.** N1 is absolute, and a single ACID database with a unique constraint is the
cheapest way to get an absolute guarantee — and the simplest thing that works.

**Cost.** The primary is a single point of failure and a write ceiling. A failover
means ~30 s of failed holds during the biggest sale of the year, and we cannot scale
writes horizontally if the business grows 10×.

**Why we accepted it.** Peak write volume is small — 67 orders/s, 167 seat updates/s —
well inside one instance. Sharding by `event_id` is the next step if needed, and the
schema is already partition-friendly. Solving a scale problem we do not have would add
distributed transactions and new failure modes, which is the opposite of what a
ticketing system needs.

### T4 — A 5-minute hold instead of 10–15

**Choice.** Holds expire in 5 minutes.

**Cost.** Slower users on bad connections may lose their seats mid-checkout, which is
frustrating and generates support tickets.

**Why.** During a 2-minute sellout, every held-but-abandoned seat is inventory that
nobody can buy. A shorter TTL returns abandoned seats to the pool ~3× faster, which
matters far more than checkout comfort on a hot event. For low-demand events the TTL
could be configurable per event.
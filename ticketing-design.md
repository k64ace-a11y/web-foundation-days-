# TicketHub System Design & Scaling Architecture

This document presents the full system architecture, traffic estimations, API design,
data model, concurrency controls, and trade-offs for **TicketHub** — a high-concurrency
event ticketing platform built to handle high-demand ticket sales for popular concerts
without crashing or double-booking seats.

---

## 1. System Requirements

### Functional Requirements
- **Browse Events:** Users can browse available concerts and view event details.
- **View Seat Maps:** Users can view real-time seat availability for an event.
- **Hold Seats:** Users can temporarily hold a seat for 10 minutes to complete checkout.
- **Purchase Tickets:** Users can securely process payment and finalize ticket purchases.
- **View Purchased Tickets:** Users can view their active and past ticket purchases.

### Non-Functional Requirements

**Correctness (highest priority)**
- **Zero double-booking:** a seat is never held or sold twice, under any concurrency,
  retry, or partial failure. We would rather refuse a purchase than oversell.
- **Exactly-once payment:** a buyer is charged once even if they double-click, retry,
  or the network drops mid-request.
- **No lost orders:** a confirmed order is durably written before the buyer sees
  "confirmed".

**Speed & Availability**
- Browsing and event details: p95 under 200 ms.
- Seat map: p95 under 300 ms normally, under 800 ms during a sale. A seat map a few
  seconds stale is acceptable, because the hold re-checks the database.
- Hold request: p95 under 500 ms — the moment the buyer is most anxious.
- The platform must withstand ~3,300 requests/second for 10 minutes during a
  high-demand sale without crashing or slowing to a crawl.

**Fairness**
- A strict first-come, first-served mechanism for high-demand releases, so that arrival
  order — not connection speed or refresh rate — decides who gets a chance to buy.
- Maximum 6 seats per event per user, enforced on the server, so one buyer cannot take
  a whole row.
- Seat availability updates are pushed to everyone at once, so nobody gains a head start
  by polling harder.

---

## 2. Traffic Estimates (Normal vs. Big Sale)

### Baseline Facts
- **Registered Users:** 2,000,000.
- **Normal Day Traffic:** 50,000 daily active users, viewing an average of 10 pages each.
- **Normal Day Sales:** 5,000 tickets sold per day.
- **Big Sale Event:** 200,000 users attempt to purchase 20,000 available seats within
  the first 10 minutes (600 seconds) of release, viewing ~10 pages each.

### A. Normal Day Traffic Estimates
- **Read Operations per Day:** 50,000 users × 10 pages = 500,000 page reads/day.
- **Average Read Throughput:** 500,000 ÷ 86,400 s = **~5.8 reads/sec**.
- **Average Write Throughput:** 5,000 tickets ÷ 86,400 s = **~0.06 writes/sec**.

### B. Peak Traffic Estimates ("Big Sale" On-Sale Event)
- **Timeframe:** 10 minutes = 600 seconds.
- **Peak Read Operations:** 200,000 users × 10 pages = 2,000,000 page reads.
- **Peak Read Throughput:** 2,000,000 ÷ 600 s = **~3,333 reads/sec**.
- **Peak Write Throughput:** 20,000 tickets ÷ 600 s = **~33.3 writes/sec**.
- **The herd at t=0:** everyone arrives at once, so the first seconds are several times
  the average before the waiting room smooths it out.
- **Only 20,000 seats exist**, so at most 20,000 orders can succeed. **180,000 people
  must be told quickly and politely that they missed out** — that is a load problem in
  itself.

### C. Comparison Summary

| Dimension | Normal day | Big sale | Ratio |
|---|---|---|---|
| Read throughput | 5.8 reads/s | 3,333 reads/s | **~574×** |
| Write throughput | 0.06 writes/s | 33.3 writes/s | **~555×** |
| Seats sold/s | ~0.06 | ~167 (20,000 in ~2 min) | ~2,800× |
| Duration | all day | 10 minutes | — |

The normal day is trivially small — a single database could serve it. **The entire
design exists for the ~574× spike**, and the two halves of that spike are different
problems: the ~3,333 reads/sec of seat maps is a **caching problem**, while the ~33
writes/sec (and ~167 seats/sec at the very start) against 20,000 rows of one event is a
**concurrency problem**.

---

## 3. API Design

The TicketHub REST API provides the following core endpoints:

| Method | Endpoint Path | Description | Success Status |
| :--- | :--- | :--- | :--- |
| `GET` | `/events` | Browse all upcoming concerts and events | `200 OK` |
| `GET` | `/events/{id}/seats` | View seat map and availability (`available`, `held`, `booked`) | `200 OK` |
| `POST` | `/seats/{id}/hold` | Temporarily hold a seat for 10 minutes during checkout | `200 OK` |
| `POST` | `/orders` | Complete payment and finalize purchase (requires `Idempotency-Key` header) | `201 Created` |
| `GET` | `/users/{id}/tickets` | Retrieve all active and historical tickets owned by the user | `200 OK` |

`409 Conflict` is returned when a hold or purchase clashes with the current state — the
seat is no longer available.

**Idempotency.** Every mutating endpoint accepts an `Idempotency-Key` header. For
`POST /orders` this matters most: if the buyer's network drops after the charge and the
client retries with the same key, the server returns the original response instead of
charging again or creating a second order. Combined with the `UNIQUE (seat_id)`
constraint on `order_seats` (§4), a retried purchase can never produce a duplicate sale.

---

## 4. Data Model & Double-Booking Prevention

### Tables & Relationships

- **`users`:** `id` (PK), `name`, `email` (UNIQUE), `password_hash`, `created_at`
- **`events`:** `id` (PK), `title`, `date`, `venue`, `created_at`
- **`seats`:** `id` (PK), `event_id` (FK → `events.id`), `section`, `row_label`,
  `seat_number`, `status` (`available`, `held`, `booked`), `user_id` (FK → `users.id`,
  NULL), `hold_expires_at` (NULL), `updated_at`,
  `UNIQUE (event_id, section, row_label, seat_number)`
- **`orders`:** `id` (PK), `user_id` (FK → `users.id`), `event_id` (FK → `events.id`),
  `total_price`, `status`, `idempotency_key` (UNIQUE), `created_at`
- **`order_seats`:** `order_id` (FK → `orders.id`), `seat_id` (FK → `seats.id`),
  PRIMARY KEY (`order_id`, `seat_id`), **UNIQUE (`seat_id`)**

#### Entity Relationships
- `events` has a **1:N (One-to-Many)** relationship with `seats`.
- `users` has a **1:N (One-to-Many)** relationship with `orders`.
- An order has **many seats** through `order_seats`, and each seat appears in **at most
  one order** — enforced by `UNIQUE (seat_id)`.
- `users` has a **1:N** relationship with `seats` when seats are held or purchased.

The composite `UNIQUE (event_id, section, row_label, seat_number)` key means the same
seat number can exist at different events without colliding, while a physical seat can
never appear in two orders.

---

### Preventing Double-Booking via Database Concurrency & ACID Transactions

Preventing two users from holding or purchasing the exact same seat relies on relational
database **ACID transactions**, strict unique constraints, and row-level locking. When a
user requests to hold or purchase a seat, the application executes a conditional atomic
update inside an isolated transaction:

```sql
UPDATE seats
SET status = 'held', user_id = 42, hold_expires_at = NOW() + INTERVAL '10 minutes',
    updated_at = NOW()
WHERE id = 1001
  AND status = 'available'
   OR (status = 'held' AND hold_expires_at < NOW());
```

Alternatively, the system can employ row-level pessimistic locking via
`SELECT ... FOR UPDATE`:

```sql
BEGIN TRANSACTION;
SELECT * FROM seats WHERE id = 1001 AND status = 'available' FOR UPDATE;
-- If the seat is still available, mark it as held:
UPDATE seats SET status = 'held', user_id = 42, updated_at = NOW() WHERE id = 1001;
COMMIT;
```

**Why this works.** The transaction runs at **READ COMMITTED** (Postgres's default),
which is exactly the level this pattern needs. When the `UPDATE` runs, Postgres takes a
**row-level lock** on every row it matches. If two users click "Buy" on seat `1001` at
the same millisecond, the database serializes them: the first acquires the lock, changes
`'available'` → `'held'`, and commits. The second blocks on the lock; when the first
commits, Postgres re-checks the `WHERE` clause against the *newly committed* row rather
than its old snapshot, sees the status is no longer `'available'`, and the row **drops
out of its result set**. The conditional update returns zero affected rows, the
application rolls back, and the user receives an immediate `409 Conflict` saying the seat
has already been taken. The check and the change are one atomic step performed by the
database, so there is no gap between them for a second buyer to slip through.

**Expired holds return automatically.** Because the `WHERE` clause treats an expired
hold as available, a seat abandoned at checkout becomes buyable again as soon as
`hold_expires_at` passes — no background job is strictly required, though a periodic
sweeper can tidy up.

**A second, independent safety net.** The logic above is correct, but correctness should
not depend on every code path being written perfectly. The `UNIQUE (seat_id)` constraint
on `order_seats` means that even if a bug, a retried worker, or a manual script tried to
attach the same seat to a second order, the database refuses to commit — an oversell
becomes a failed request instead of a double sale:

```sql
CREATE UNIQUE INDEX one_order_per_seat ON order_seats (seat_id);
```

**Why this holds at the peak write rate.** Row locks are taken **per seat**, not per
event. Two buyers competing for different seats never block each other, so the write
load is spread across 20,000 independent rows rather than serialized behind a single
lock — which is what keeps the system fast at 33 writes/sec sustained and ~167 seats/sec
during the opening rush.

---

## 5. System Architecture & Surviving the Big Sale

### Architecture Diagram

```text
                              +--------------------------+
                              | Client (Browser / App)   |
                              +------------+-------------+
                                    |            |
                      Static Assets |            | API Requests
                      (HTML/CSS/JS) v            v
                        +---------------+    +---------------+
                        |      CDN      |    | Load Balancer |
                        +---------------+    +-------+-------+
                                                     |
                                                     v
                                         +-----------------------+
                                         | Virtual Waiting Room  |
                                         | (Fairness Queue)      |
                                         +-----------+-----------+
                                                     |
                                                     v
                                         +-----------------------+
                                         | Stateless App Servers |
                                         +---+-------+-------+---+
                                             |       |       |
                                             v       |       v
                                     +---------------+ | +---------------+
                                     | Cache (Redis) | | | Message Queue |
                                     +---------------+ | +-------+-------+
                                                       v         |
                                             +-----------------+ |
                                             | Primary DB      |<+
                                             | (Writes)        |
                                             +--------+--------+
                                                      |
                                                      v
                                             +-----------------+
                                             | Read Replicas   |
                                             | (Reads)         |
                                             +-----------------+
```

### Component Explanations

- **Client (Browser / Mobile App):** Delivers the interactive UI for browsing concerts,
  picking seats, queuing in the waiting room, and submitting payment.
- **CDN (Content Delivery Network):** Caches and serves static page assets globally to
  minimize server load and deliver fast page loads.
- **Load Balancer:** Evenly distributes incoming traffic across the app tier so no single
  server is overwhelmed during a surge.
- **Virtual Waiting Room (Queue):** Admits users at a controlled rate on a
  first-come-first-served basis, protecting the backend from overload.
- **Stateless App Servers:** Execute business logic, authentication, seat holding, and
  order processing without storing session state locally, so they can scale horizontally.
- **In-Memory Cache (Redis):** Caches seat maps and event metadata in RAM to serve reads
  in milliseconds and shield the primary database from read spikes.
- **Message Queue (RabbitMQ / Kafka):** Buffers asynchronous work like confirmation
  emails and ticket PDF generation during high-volume releases.
- **Primary Database (Writes):** The single source of truth for write transactions,
  enforcing data integrity, row locks, and zero double-booking.
- **Database Read Replicas (Reads):** Asynchronously replicate from the primary to serve
  high read volume without interfering with writes.

### Surviving the Big Sale

1. **Virtual Waiting Room (Queue).** When 200,000 users hit the platform at once,
   letting all of them reach the database would crash it immediately. The waiting room
   intercepts arrivals, assigns each a queue position bound to their session, and admits
   users at a rate the backend can absorb — roughly 2,000 requests/second. Crucially,
   refreshing does **not** re-enqueue a user or improve their position, so scripting the
   API buys no advantage and fairness is by arrival order. If the gateway also rejects
   requests that lack a valid admission token, the queue is enforced at the edge rather
   than being merely advisory.
2. **Redis Caching for Seat Maps.** The ~3,333 reads/sec generated by users viewing seat
   maps are served from an in-memory **Redis** cluster rather than the primary database.
   The primary therefore stays free to handle the critical write transactions
   (`POST /seats/{id}/hold` and `POST /orders`). Because the cached map may be a few
   seconds stale, a buyer can occasionally click a seat that has just been taken — but
   the conditional update in §4 is the authority, so that costs a `409` and a re-pick,
   never an oversell.
3. **Auto-scaling and read replicas.** App servers scale out ahead of a known on-sale
   and back in afterwards; browsing and search are served from read replicas so they
   never compete with holds for primary capacity.
4. **Asynchronous after-care.** Emails, PDFs, and ticket QR generation happen on workers
   behind the queue, keeping the checkout path short.

**Degradation.** If Redis fails, the system falls back to the database and gets slower
but stays correct. If a payment worker dies, the idempotency key makes the retry safe.
If the primary fails over, in-flight holds return `503` and users retry. In every case
**no seat is sold twice** — inconvenience is acceptable, an oversell is not.

---

## 6. Architectural Trade-offs

1. **Caching Seat Maps vs. Stale Read Window.**
   - *Trade-off:* Serving seat availability from Redis lets the system handle ~3,333
     reads/sec with sub-10 ms responses. The cost is eventual consistency: a user may
     briefly see a seat as available after another user has held it, causing occasional
     "seat taken" errors at checkout.
   - *Why we accept it:* the alternative — every map read hitting the primary — would
     collapse under the sale. The stale window costs a user at most one extra click,
     because the hold re-validates against the database.

2. **Virtual Waiting Room vs. Immediate User Experience.**
   - *Trade-off:* A waiting room guarantees backend stability and absolute fairness
     during major releases, but it adds friction — users wait in a queue instead of
     picking seats immediately, and some who would have succeeded anyway wait longer.
   - *Why we accept it:* a slow, fair, working site beats a fast, unfair, crashed one.
     Without the queue the release degenerates into a race won by the fastest connection
     and the best bot, which is a direct subsidy to scalpers. The queue is also the only
     component that bounds load, which is what lets the rest of the architecture stay
     simple.

3. **One Primary Database vs. Horizontal Write Scaling.**
   - *Trade-off:* Routing all seat ownership through a single Postgres primary gives an
     absolute correctness guarantee, but makes it a single point of failure and a ceiling
     on write throughput.
   - *Why we accept it:* peak write volume is small (33 writes/sec sustained, ~167
     seats/sec at the opening rush) — far inside one instance. Sharding by `event_id` is
     the next step if the business grows, and the schema is already partition-friendly.
     Adding distributed transactions to solve a scale problem we do not have would
     introduce new failure modes, which is the opposite of what a ticketing system needs.
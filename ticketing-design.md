TicketHub — Event Ticketing System Design
1. Requirements
Functional requirements
1. Users can register, sign in, and manage their accounts.
2. Users can browse and search events, view event details, and see venue maps, seats, and prices.
3. Users can temporarily hold available seats while they complete checkout.
4. Users can pay for an order and receive confirmed digital tickets after payment succeeds.
5. Users can view their orders and tickets and request cancellation or a refund when the event policy allows it.
6. Organisers can create events, assign venues and prices, and view sales.
7. Administrators can manage events and users and investigate suspicious sales activity.
Non-functional requirements
- Speed: event pages should load within 2 seconds for 95% of requests under normal expected load. A seat-hold request should usually respond within 3 seconds, not counting time spent at the external payment provider.
- Correctness: one seat for one event must never be sold to two customers. Reservation and payment updates must remain correct when requests are repeated or arrive at the same time.
- Fairness: during a popular sale, users should enter a waiting room with clear rules and be admitted in a published, consistent order. Refreshing the page must not improve a user's place in the queue. Rate limits and bot detection should limit automated abuse without unfairly blocking ordinary users.
- Availability: browsing event details should continue even if checkout is busy. If the system is overloaded, it should queue or reject new hold attempts clearly rather than fail unpredictably.
- Scalability: web and read services should scale horizontally as demand grows. Inventory-changing operations must still be controlled by the database.
- Security and privacy: use HTTPS, secure password hashing, authorization checks, input validation, and a trusted payment provider. Do not store raw card details. Collect only necessary personal data.
- Reliability: use backups, monitoring, alerts, and recovery procedures. Make payment processing and background-job retries idempotent.
- Accessibility: support mobile screens, keyboard navigation, readable contrast, and clear queue, loading, and error messages.
2. Traffic and capacity estimates
Normal day
Given 50,000 visitors per day, 10 page views per visitor, 5,000 tickets sold per day, and 2 million registered users:
- Page views per day = 50,000 × 10 = 500,000 page views.
- Average page views per second = 500,000 ÷ 86,400 ≈ 5.8 page views/second.
- Average ticket sales rate = 5,000 ÷ 86,400 ≈ 0.058 tickets/second, or about 5 tickets every 86 seconds.
- The 2 million registered users describes the account base; it does not mean they are all online at once.
These figures are daily averages. Actual traffic varies by hour, and one page can trigger several API calls, so the system must be tested above the average rate.
Popular concert sale
A popular concert has 20,000 seats, and 200,000 people try to buy them in the first 10 minutes:
- 10 minutes = 600 seconds.
- Average incoming buyer attempts = 200,000 ÷ 600 ≈ 333 attempts/second.
- Demand is 200,000 ÷ 20,000 = 10 buyers per seat.
- If all seats are sold during that 10-minute window, the average completed sales rate is 20,000 ÷ 600 ≈ 33.3 tickets/second.
The 333 buyer attempts/second is about 57 times the normal average of 5.8 page views/second, although page views and purchase attempts are different types of traffic, so this is only an indication of the increase in pressure. The sale may also arrive in a much sharper burst than the 10-minute average. TicketHub should cache public event information, use a fair waiting room and rate limits, scale stateless services, and load-test the reservation database. Cached seat availability is only for display; every seat hold must be checked against the database.
3. API design
All endpoints use HTTPS and JSON. User-specific endpoints require a valid login session or access token.
Method and endpoint	Purpose
POST /api/v1/auth/register	Register a user.
POST /api/v1/auth/login	Authenticate a user.
GET /api/v1/events	Browse or search events with pagination and filters.
GET /api/v1/events/{eventId}	View event date, venue, and information.
GET /api/v1/events/{eventId}/seats	View seats, prices, and displayed availability.
POST /api/v1/reservations	Temporarily hold one or more seats for the signed-in user.
POST /api/v1/orders	Create an order from an active reservation and begin checkout.
POST /api/v1/payments/webhook	Receive and verify payment-provider updates.
GET /api/v1/orders/{orderId}	View the order and payment status.
GET /api/v1/users/me/tickets	List tickets belonging to the signed-in user.


Important API behaviour
- A reservation request contains an event ID and the requested seat IDs. The system must claim all requested seats in one database transaction or claim none.
- A hold lasts five minutes. The reservation API checks the hold expiry, and a background worker releases expired holds safely.
- Return 201 Created when a reservation is made, 409 Conflict when one or more seats are held or sold, and 401 Unauthorized when authentication is missing.
- Order and payment requests use idempotency keys so a retry caused by a slow connection does not create a second order or charge.
- Payment webhooks must be verified and handled idempotently. TicketHub must not trust a message from the browser as proof of payment.
4. Data model
Primary keys uniquely identify rows. Foreign keys connect related tables and help prevent records from referring to missing users, events, or orders.
Users
- user_id — primary key
- name
- email — unique
- password_hash
- created_at
Venues
- venue_id — primary key
- name
- address
Events
- event_id — primary key
- title
- venue_id — foreign key to Venues
- starts_at
- status
Seats
- seat_id — primary key
- venue_id — foreign key to Venues
- section, row_label, seat_number
- Unique constraint on (venue_id, section, row_label, seat_number)
Reservations
- reservation_id — primary key
- user_id — foreign key to Users
- status — HELD, CONFIRMED, EXPIRED, or CANCELLED
- expires_at
- created_at
EventSeats
EventSeats stores the inventory state for a physical seat at a particular event. The same physical seat can be sold at different events on different dates, so availability is tracked per event rather than on Seats alone.
- event_id — foreign key to Events
- seat_id — foreign key to Seats
- price
- status — AVAILABLE, HELD, or SOLD
- reservation_id — nullable foreign key to Reservations
- hold_expires_at — nullable timestamp
- Composite primary key: (event_id, seat_id)
Orders
- order_id — primary key
- reservation_id — foreign key to Reservations, unique if one order is allowed per reservation
- user_id — foreign key to Users
- total_amount
- status — PENDING, PAID, FAILED, or REFUNDED
- created_at
Payments
- payment_id — primary key
- order_id — foreign key to Orders
- provider_reference — unique
- amount
- status
- created_at
Relationships
- One venue contains many physical seats and can host many events.
- One event takes place at one venue and has many EventSeats inventory records.
- One user can create many reservations and orders.
- One reservation can contain multiple event-seat records.
- A reservation can produce an order. An order may have payment attempts, and each payment-provider reference must be unique.
How double-booking is prevented: transaction walkthrough
The database is the final authority for seat ownership. The seat map shown in the browser may be slightly out of date; a seat is not guaranteed until the reservation transaction succeeds.
1. Start the transaction. When a user submits a hold request, the reservation service starts a database transaction and loads the relevant EventSeats rows. For multiple seats, it locks them in a consistent order (for example, sorted by seat_id) to reduce deadlocks.
2. Lock and check. The service locks the rows using a row-level locking method such as SELECT ... FOR UPDATE, then checks that every requested row is AVAILABLE. The composite primary key on (event_id, seat_id) also ensures that only one inventory row can exist for each seat at each event.
3. Claim all seats together. If all requested seats are available, the service creates a Reservations row and changes each corresponding EventSeats row to HELD, storing the reservation ID and five-minute expiry timestamp. It then commits the transaction. If any requested seat is not available, it rolls back the entire transaction and returns 409 Conflict, so the user is not left with only part of a multi-seat request.
4. Handle simultaneous requests. Suppose customers A and B both request seat A-12 at almost the same moment. Customer A obtains the row lock first. Customer B must wait. When A commits the change to HELD, B continues, sees the updated status, and receives 409 Conflict. B cannot also hold the seat. A conditional atomic update such as UPDATE EventSeats SET status = 'HELD' ... WHERE status = 'AVAILABLE' can be used instead if the service checks that exactly one row was updated per requested seat.
5. Complete payment safely. After payment is confirmed through a verified provider webhook, another transaction checks that the reservation is still valid and changes its seats from HELD to SOLD and the order to PAID. Idempotency keys and unique provider references prevent a retry or repeated webhook from creating duplicate logical payments.
6. Release expired holds safely. A background worker locks an expired hold and releases it only when the row is still HELD and the expiry has passed. Payment confirmation and expiry processing must check the current status inside a transaction so they cannot overwrite each other. If payment succeeds after a hold has expired and the seat has already been reassigned, the system must use a safe recovery path, such as a refund, rather than issuing a ticket for a seat that belongs to someone else.
The row lock and the state check prevent concurrent requests from claiming the same inventory record. The transaction ensures that all requested seats are held together, while the composite primary key prevents duplicate event-seat inventory records.
5. Architecture diagram and explanation
                         +-----------------------+
                         | Web / Mobile Client   |
                         +-----------+-----------+
                                     | HTTPS
                         +-----------v-----------+
                         | CDN + WAF + Rate      |
                         | Limiter + Fair Queue  |
                         +-----------+-----------+
                                     |
                         +-----------v-----------+
                         | Load Balancer / API   |
                         | Gateway               |
                         +-------+-----------+---+
                                 |           |
                  +--------------v--+    +---v------------------+
                  | Event / Search  |    | Reservation /        |
                  | Service         |    | Order Service        |
                  +--------+--------+    +----------+-----------+
                           |                        |
                  +--------v--------+      +--------v-----------+
                  | Cache / Search  |      | Relational Database|
                  | Index           |      | Transactions,      |
                  +-----------------+      | row locks, keys    |
                                           +--------+-----------+
                                                    |
                                  payment request   |
                                  +-----------------v------+
                                  | External Payment       |
                                  | Provider               |
                                  +-----------+------------+
                                              | webhook
                                  +-----------v------------+
                                  | Verified Payment       |
                                  | Webhook Handler        |
                                  +-----------+------------+
                                              |
                                  +-----------v------------+
                                  | Queue + Background     |
                                  | Workers: hold expiry,  |
                                  | tickets, notifications |
                                  +------------------------+

                   Monitoring, metrics, alerts, and logs
                       cover all services and the DB
Component explanation
- Web/mobile client: allows customers to browse, choose seats, pay, and view tickets.
- CDN: serves static files and cached public event pages, reducing latency and load on the application.
- WAF and rate limiter: filter common malicious requests and reduce excessive traffic.
- Fair waiting room: gives users queue positions according to a published rule and admits users at a controlled rate. Refreshing must not let a user jump ahead.
- Load balancer/API gateway: sends requests to healthy application instances and applies shared API policies. Application instances can scale horizontally because they do not depend on local session state.
- Event/search service and cache: handle browsing and search. Cached event information reduces reads on the main database. Cached seat status is only a display hint and never confirms a sale.
- Reservation/order service: validates requests, applies reservation rules, creates holds, and coordinates checkout.
- Relational database: stores users, events, physical seats, event-seat inventory, reservations, orders, and payments. Transactions, row locks, and constraints protect seat ownership.
- Payment provider and webhook handler: process payment through a specialist provider. The webhook handler verifies provider messages before updating the order; the system never stores raw card details.
- Queue/background workers: send emails, issue digital tickets, and release expired holds without making the customer wait for every background task to finish.
- Monitoring and logs: track response times, errors, queue length, failed payments, and database contention. Logs must not include passwords, access tokens, or payment secrets.
How the architecture handles the big sale
The CDN and cache absorb much of the read traffic for event pages. The fair waiting room controls the flow of people from browsing into seat reservation instead of allowing all 200,000 buyers to hit the database at once. The load balancer spreads admitted requests across multiple application instances, which can scale horizontally. The reservation service then makes short, transactional writes to the relational database; if a seat is already held, the transaction fails safely and the API returns a clear conflict response. Background workers issue tickets and send messages after checkout so these tasks do not slow down seat holds. Monitoring alerts operators if queue times, error rates, or database lock waits become too high. Correctness is maintained by the database even if traffic briefly exceeds capacity; the queue improves stability but does not replace transaction-level seat protection.
6. Trade-offs
Trade-off 1: Relational database vs. NoSQL
A relational database is a good fit for inventory and orders because transactions, foreign keys, row locks, and unique constraints make seat ownership easier to protect. Its downside is contention when many buyers try to update inventory simultaneously. A waiting room, short transactions, good indexes, and load testing reduce that risk. A NoSQL store may scale some read workloads well, but it would need carefully designed conditional writes and consistency rules to prevent double-booking.
Trade-off 2: Temporary seat holds vs. no holds
Temporary holds give a buyer time to complete checkout and reduce the chance that a seat disappears during payment. However, abandoned holds block seats for a short period and could be abused by bots. Short expiry times, per-user hold limits, bot detection, and reliable expiry processing reduce the problem.
Trade-off 3: Cached data vs. live database reads
Caching public event information improves speed and lowers database load during a sale. The disadvantage is that seat availability shown on the page can become stale. TicketHub therefore uses cache for display only and confirms every hold against the transactional database.
Trade-off 4: Waiting room vs. immediate access
A waiting room reduces overload and gives customers a predictable sale process, but it means some customers wait before buying. TicketHub should explain the queue rules, keep them consistent, and show the user's status. This is a reasonable trade-off because allowing every buyer to compete directly for database locks could make the entire sale unstable.
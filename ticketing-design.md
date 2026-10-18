TicketHub — System Design
1. Requirements
Functional requirements
- Users can register, sign in, browse and search events, and view event details.
- Users can view a venue's seats and prices for a selected event.
- Users can temporarily hold available seats, pay for the reservation, and receive tickets after successful payment.
- Users can view their orders and tickets and cancel them where event policy allows.
- Organisers can create events, set prices, and view sales. Administrators can manage events, users, refunds, and suspicious activity.
Non-functional requirements
- Speed: event pages should load within 2 seconds for 95% of requests under expected load. Seat holds should usually respond within 3 seconds, excluding payment-provider delays.
- Correctness: a seat must never be sold to two people. Orders and payment updates must be processed once logically, even if a request is retried.
- Fairness: during a major sale, a waiting room should give users a clear queue position and admit them in a published, consistent order. Users must not gain an advantage by refreshing repeatedly. Rate limits and bot detection should reduce automated abuse without unfairly blocking ordinary customers.
- Availability: event browsing should remain available during busy sales, even if checkout is throttled or queued.
- Scalability: web and read services should scale horizontally as traffic increases; seat inventory writes must remain controlled and consistent.
- Security and privacy: use HTTPS, secure password hashing, access controls, input validation, limited personal-data collection, and a trusted payment provider. Never store raw card details.
- Reliability: use backups, monitoring, alerts, and recovery procedures. Retry background jobs safely and make payment handling idempotent.
- Accessibility: support mobile screens, keyboard navigation, readable contrast, and clear queue and error messages.
2. Traffic and capacity estimates
Normal day
Given 50,000 visitors per day, 10 page views per visitor, and 5,000 tickets sold per day:
- Page views per day = 50,000 × 10 = 500,000.
- Average page views per second = 500,000 ÷ 86,400 ≈ 5.8 page views/second.
- Average ticket sales rate = 5,000 ÷ 86,400 ≈ 0.058 tickets/second (about 5 tickets every 86 seconds).
- The platform has 2 million registered users; this is the account base, not the number online at once.
These are daily averages, not peak values. Real traffic changes by hour, and each page may trigger several API requests.
Popular concert sale
200,000 people attempt to buy 20,000 seats within the first 10 minutes:
- 10 minutes = 600 seconds.
- Average incoming buyer attempts = 200,000 ÷ 600 ≈ 333 attempts/second.
- Demand is 10 people for each seat (200,000 ÷ 20,000 = 10).
- If all seats sell during the window, the average completed sale rate is 20,000 ÷ 600 ≈ 33.3 tickets/second.
The 333 attempts/second sale figure is roughly 57 times the normal average of 5.8 page views/second, though these are different kinds of activity and are not a perfect like-for-like comparison. Traffic can also arrive in a sharper burst than the 10-minute average. Therefore, TicketHub should cache public event information, use a fair waiting room and rate limits, scale stateless services, and load-test the reservation database. Cached seat availability is only for display; every hold must be checked against the database.
3. API design
All endpoints use HTTPS and JSON. Endpoints marked as user-specific require a signed-in session or access token.
Method and endpoint	Purpose
GET /api/v1/events	Browse/search events with pagination and filters.
GET /api/v1/events/{eventId}	View event details, time, venue, and ticket information.
GET /api/v1/events/{eventId}/seats	View seats, prices, and displayed availability.
POST /api/v1/reservations	Hold one or more seats for the signed-in user for a short time.
POST /api/v1/orders	Create an order from an active reservation and start checkout.
POST /api/v1/payments/webhook	Receive and verify payment-provider updates.
GET /api/v1/users/me/tickets	View tickets belonging to the signed-in user.
GET /api/v1/orders/{orderId}	Check order and payment status.


Important behaviour:
- A reservation request includes the event ID and requested seat IDs. It must claim all requested seats in one database transaction or claim none of them.
- A hold expires after five minutes if checkout is not completed. The API checks the expiry time, and a background worker releases expired holds.
- Return 409 Conflict if a seat is already held or sold, 401 Unauthorized if the user is not authenticated, and 201 Created when a reservation succeeds.
- Order creation and payment processing accept idempotency keys so network retries do not create duplicate orders or charges.
- Verify payment-provider webhooks and process each provider event idempotently. Do not mark seats as sold simply because the browser says payment succeeded.
4. Data model
The core model uses the tables below. Primary keys identify rows; foreign keys connect related records.
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
EventSeats
This is the seat inventory for a particular event. The same physical seat can be sold at different events, so availability must be tracked per event.
- event_id — foreign key to Events
- seat_id — foreign key to Seats
- price
- status — AVAILABLE, HELD, or SOLD
- reservation_id — nullable foreign key to Reservations
- hold_expires_at — nullable timestamp
- Primary key on (event_id, seat_id)
Reservations
- reservation_id — primary key
- user_id — foreign key to Users
- status — HELD, CONFIRMED, EXPIRED, or CANCELLED
- expires_at
- created_at
Orders
- order_id — primary key
- reservation_id — foreign key to Reservations, unique if only one order is allowed per reservation
- user_id — foreign key to Users
- total_amount
- status — for example PENDING, PAID, FAILED, or REFUNDED
- created_at
Payments
- payment_id — primary key
- order_id — foreign key to Orders
- provider_reference — unique
- amount
- status
- created_at
Relationships
- One venue has many physical seats and can host many events.
- One event has one venue and many event-seat inventory records.
- One user can create many reservations and orders.
- One reservation can hold multiple EventSeats records.
- A reservation can create an order, and an order can have payment attempts. Each provider reference must be unique.
How double-booking is prevented
The database is the final authority; the seat map in the browser is not. Each event-seat pair has exactly one EventSeats row because (event_id, seat_id) is its primary key. When a user asks to hold seats, the reservation service opens a transaction and locks the requested inventory rows (in a consistent order). It checks that every seat is available, then changes all of them to HELD, stores the reservation ID and expiry time, and commits. If even one seat is unavailable, the transaction rolls back so the customer does not receive only part of the requested group.
If two people request the same seat at the same time, the database lock makes one wait. After the first transaction commits, the second request sees that the seat is held or sold and receives 409 Conflict. A conditional update that changes a row only when its status is AVAILABLE can provide the same protection, with the affected-row count checked. The unique primary key also prevents duplicate inventory records for an event-seat pair.
After verified payment, a transaction marks the reservation confirmed and its event seats SOLD. If a hold expires, a worker locks the row and releases it only if it is still HELD and its expiry time has passed. Payment confirmation and expiry processing must check the current status so they cannot overwrite each other incorrectly. If payment succeeds after a hold has expired and the seat has been reassigned, the order needs a safe recovery path, such as refunding the payment. Idempotency keys prevent duplicate order/payment processing.
5. Architecture diagram and components
                         +----------------------+
                         | Web / Mobile Client  |
                         +----------+-----------+
                                    | HTTPS
                         +----------v-----------+
                         | CDN + WAF + Fair     |
                         | Waiting Room /       |
                         | Rate Limiter         |
                         +----------+-----------+
                                    |
                         +----------v-----------+
                         | Load Balancer / API  |
                         | Gateway              |
                         +------+----------+----+
                                |          |
                    +-----------v--+    +--v------------------+
                    | Event/Search |    | Reservation /       |
                    | Service      |    | Order Service       |
                    +------+-------+    +----------+----------+
                           |                       |
                    +------v-------+      +--------v----------+
                    | Cache /      |      | Relational DB     |
                    | Search Index |      | + Transactions    |
                    +--------------+      +--------+----------+
                                                    |
                                         +----------v----------+
                                         | Payment Provider +  |
                                         | Verified Webhook    |
                                         +----------+----------+
                                                    |
                                         +----------v----------+
                                         | Queue + Workers     |
                                         | Expiry, tickets,    |
                                         | notifications       |
                                         +---------------------+
Component explanation
- Web/mobile client: lets customers browse, choose seats, pay, and view tickets.
- CDN: serves static files and cached public event pages quickly without sending every read to the application servers.
- WAF and rate limiter: filters common malicious traffic and limits excessive requests.
- Fair waiting room: assigns queue positions using a published rule and admits users at a controlled rate. Refreshing should not improve someone's place.
- Load balancer/API gateway: distributes requests across healthy application instances and enforces shared API policies.
- Event/search service: supports event browsing. A cache or search index makes public read traffic cheaper; it does not decide whether a seat can be bought.
- Reservation/order service: validates users, creates temporary holds, and manages checkout.
- Relational database: stores accounts, events, inventory, reservations, orders, and payments. Transactions, row locks, and constraints enforce correct seat ownership.
- Payment provider/webhook handler: processes card payments without TicketHub storing raw card numbers; verified callbacks update payment status.
- Queue/background workers: send email, generate tickets, and release expired holds outside the user's request path.
- Monitoring and logs: track response time, error rates, queue length, failed payments, and database contention so operators can respond to overload. Logs must not expose passwords or payment secrets.
How it survives the big sale
The CDN and cache handle much of the event-page traffic. The waiting room prevents all 200,000 interested buyers from hitting checkout at once and admits people at a rate the reservation system can sustain. Stateless application instances can scale horizontally behind the load balancer. The transactional inventory database protects correctness even under concurrent requests; the system queues or rejects excess checkout requests rather than selling the same seat twice. Background workers handle ticket generation and notifications so these jobs do not slow seat reservation. Monitoring and load testing help identify bottlenecks before a major release.
6. Trade-offs
Trade-off 1: Relational database vs. NoSQL
A relational database is preferred for inventory and orders because transactions, foreign keys, and constraints make seat ownership easier to protect. The downside is contention when many buyers attempt writes at once. A waiting room, short transactions, indexes, and load testing reduce this risk. A NoSQL store may scale some read workloads well, but would need careful conditional-write and consistency design to prevent double-booking.
Trade-off 2: Temporary holds vs. no holds
Temporary holds give buyers time to complete checkout and reduce the chance that a seat disappears during payment. However, abandoned holds block seats briefly and could be abused. Short expirations, per-user limits, bot detection, and reliable expiry processing help limit this problem.
Trade-off 3: Cached pages vs. live reads
Caching reduces latency and database load during a sale, but cached seat maps may be stale. Therefore, use cache for display only and validate every hold against the transactional database.
Trade-off 4: Waiting room vs. immediate access
A waiting room protects the system and gives users a consistent process, but some customers must wait. TicketHub should explain the queue rules, avoid allowing refreshes to jump the queue, and monitor waiting times. A strict queue is less immediate, but safer than allowing every request to compete directly for the database.
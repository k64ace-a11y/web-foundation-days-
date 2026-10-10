SnapShare Scaling Plan
Assumptions
10,000,000 registered users.

10% are active each day, so daily active users = 10,000,000 × 0.10 = 1,000,000 DAU.

Each active user uploads 1 photo per day.

Each active user views 50 feed pages per day.

Average original photo size = 2 MB.

Average thumbnail size = 50 KB.

Each uploaded photo creates 1 original and 1 thumbnail.

Traffic is averaged over 86,400 seconds/day.

Peak traffic is 5× average.

A feed page view means one API/page request; image/thumbnail downloads are separate and usually served by the CDN.

Storage estimates use decimal units: 1 TB = 1,000 GB, 1 GB = 1,000 MB, 1 MB = 1,000 KB.

Deletes, edits, backups, and database replica storage are not counted in the storage estimate.

Photo metadata size is negligible compared with photo file storage.

Demand Estimates
Daily active users
text
DAU = 10,000,000 × 10%
    = 1,000,000 active users/day
Uploads per second
text
Uploads/day = 1,000,000 users × 1 photo/day
            = 1,000,000 photos/day

Average uploads/sec = 1,000,000 / 86,400
                    ≈ 11.6 photos/sec

Peak uploads/sec = 11.6 × 5
                 ≈ 57.9 photos/sec
Feed views per second
text
Feed views/day = 1,000,000 users × 50 feed pages/day
               = 50,000,000 feed page views/day

Average feed views/sec = 50,000,000 / 86,400
                       ≈ 578.7 feed views/sec

Peak feed views/sec = 578.7 × 5
                    ≈ 2,893.5 feed views/sec
Photo storage per year
text
Original photos/day = 1,000,000 × 2 MB
                    = 2,000,000 MB
                    = 2,000 GB
                    = 2 TB/day

Thumbnails/day = 1,000,000 × 50 KB
               = 50,000,000 KB
               = 50 GB/day

Total storage/day = 2 TB + 0.05 TB
                  = 2.05 TB/day

Total storage/year = 2.05 TB × 365
                   ≈ 748.25 TB/year
                   ≈ 0.75 PB/year
So SnapShare needs roughly 2.05 TB/day and 748 TB/year of new photo/thumbnail storage.

Read-Heavy or Write-Heavy?
SnapShare is read-heavy.

text
Feed views/day = 50,000,000
Uploads/day    = 1,000,000
Ratio          = 50:1 reads to writes
That is already 50 feed-page reads for every upload. In reality, each feed page likely loads multiple photo thumbnails, so image reads are even higher. This means the design should optimize reads first: CDN, cache, read replicas, pagination, and denormalized feed metadata. Writes are much less frequent and can be made asynchronous where possible, such as thumbnail generation.

Why Photos Should Not Be Stored Inside the Database
Photos should not be stored as BLOBs inside the database because large binary files make the database huge, slow down backups and replication, consume expensive database storage, and waste database connections and memory. Databases are optimized for structured metadata and transactions, not for serving large media files. Instead, photo files should go into object storage such as S3, GCS, or Azure Blob Storage, while the database stores only metadata like photo ID, user ID, object key/URL, timestamp, and thumbnail status.

Architecture Diagram
text
                         +----------------------+
                         |   Clients (web/app)  |
                         +----------+-----------+
                                    |
             API/feed requests      |      image/thumbnail requests
                                    v
                         +----------------------+
                         |   Load Balancer      |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |   App Servers        |<---->+----------------+
                         +--+---+---+-----------+      | Cache          |
                            |   |   |                  | feed/meta      |
                            |   |   |                  +----------------+
                            |   |   |
                            |   |   +--> [Queue: thumbnail jobs] --> [Worker: creates thumbnails]
                            |   |                                      |
                            |   |                                      v
                            |   |                           [Object Storage: originals + thumbnails]
                            |   |                                      ^
                            |   |                                      |
                            |   +--> [Database Primary]               |
                            |             |                           |
                            |             v                           |
                            |      [Database Read Replica]            |
                            |                                        |
                            +----------------------------------------+
                                               ^
                                               |
                                            [CDN] <--- clients fetch images
Component Responsibilities
Client: Starts uploads and feed requests from mobile or web apps.

CDN: Caches and serves photos and thumbnails close to users, reducing latency and origin load.

Load Balancer: Distributes API and feed traffic across multiple app servers and removes unhealthy servers.

App Servers: Run authentication, feed assembly, metadata writes, pre-signed URL creation, and thumbnail job enqueueing.

Cache: Stores hot feed pages, photo metadata, and sessions to reduce database load and improve response time.

Database Primary: Stores authoritative data such as users, follows, photo metadata, and feed entries for writes.

Database Read Replica: Serves read-heavy feed and metadata queries so the primary database is not overloaded.

Object Storage: Stores original photo files and thumbnails durably, cheaply, and at large scale.

Queue: Buffers thumbnail jobs so uploads do not have to wait for image processing.

Worker: Consumes thumbnail jobs, creates 50 KB thumbnails, uploads them, and updates metadata.

Upload Flow Step by Step
A user selects a photo in the client app.

The client sends an authenticated upload request to an app server through the load balancer.

The app server validates the user and creates a photo ID and metadata record intent.

The app server asks object storage for a pre-signed upload URL, or generates one if the storage provider supports it.

The app server returns the pre-signed URL and photo ID to the client.

The client uploads the original 2 MB photo directly to object storage using the pre-signed URL.

Object storage stores the original photo and returns success or an object key.

The client notifies the app server that the upload is complete.

The app server writes photo metadata to the database primary: photo ID, user ID, object key/URL, timestamp, and status.

The app server enqueues a thumbnail job on the queue with the photo ID and original object key.

The app server returns success to the client; the photo may appear in the feed with a placeholder until the thumbnail is ready.

A worker consumes the thumbnail job from the queue.

The worker downloads the original photo from object storage.

The worker resizes/crops the photo into a 50 KB thumbnail.

The worker uploads the thumbnail to object storage.

The worker updates the database primary with the thumbnail URL and status = ready.

The cache is updated or invalidated so future feed views can use the new thumbnail metadata.

Future feed requests read metadata from cache or the read replica and fetch images from the CDN, which pulls from object storage on a cache miss.

Trade-offs
Direct-to-object-storage uploads vs. uploading through app servers
Direct uploads reduce app server bandwidth and CPU usage and scale better, but they add complexity around pre-signed URLs, CORS, client retries, and validation.

Asynchronous thumbnail generation vs. synchronous thumbnail generation
Async thumbnails make uploads faster and decouple image processing, but thumbnails are eventually consistent, so feeds may need placeholders, retries, and dead-letter queues.

Read replicas vs. reading from the primary database
Read replicas scale the read-heavy feed workload, but replication lag can make feeds stale or hide a user’s own new upload unless the app reads from the primary for recent writes.

CDN caching vs. serving directly from object storage
CDN caching reduces latency and origin load, but it adds cost, cache invalidation complexity, and possible stale content after deletes or edits.
# Universal Smart Queue & Booking Management System — API

A multi-tenant SaaS backend that lets any service business — restaurants, hospitals, salons, banks — manage appointment bookings and live walk-in queues from one platform, with real-time updates and SMS/email notifications.

This repository contains the REST API and real-time server. The web client lives in a [separate repository](https://github.com/nyameprince205-sudo/universal-smart-queue-booking--management-frontend).

---

## What it does

**For customers** — search for a business, book a service, or join a queue as a walk-in. Track your live position from your phone with no account required; a tracking link is sent when you check in.

**For staff** — a queue console showing bookings awaiting arrival and the live queue board. Check customers in, call the next person, and complete visits, with every screen in the branch updating in real time.

**For business owners (Org Admin)** — manage branches, services, staff and counters. Dashboards for live queue status, historical analytics, and exportable reports. Handle support tickets raised by their own customers and staff.

**For the platform operator (Super Admin)** — review and approve business registration requests, manage every organization and its admin accounts, and handle escalated support tickets.

---

## Architecture

### Multi-tenancy

Every tenant-scoped table carries an `organization_id`. Tenant identity is derived from the authenticated user's JWT and attached to the request by middleware — never read from the request body or query string, so a caller cannot address another organization's data by changing a parameter.

```
Request → authenticate (verify JWT)
        → requireTenant  (attach req.tenant.organizationId from the token)
        → requireRole    (check the caller's role)
        → controller     (queries always scoped by req.tenant.organizationId)
```

Branch-scoped staff carry a `branch_id` as well, narrowing their access further — a staff member at one branch cannot see another branch's queue.

### Two separate identity systems

Staff/admin accounts (`users`) and customer accounts (`customers`) are deliberately separate tables with separate JWT signing secrets. A customer exists at the platform level and can interact with many organizations; a staff member belongs to exactly one. Modelling both as one table would have forced every query to disambiguate them.

The `customer_organizations` join table records the relationship between a customer and each business they've used, including first/last interaction and total bookings.

### Real-time layer

Socket.IO with room-based isolation rather than global broadcast:

- **Branch rooms** — staff consoles and queue displays join their own branch's room. A queue update for one branch never reaches another.
- **Customer rooms** — each customer joins a room keyed to their own id, so booking status changes push to their device only.

Events are emitted **after** the database transaction commits, never inside it — Socket.IO has no concept of a rollback, so emitting early would let clients see updates that never actually persisted.

### Notifications

Real integrations, not stubs:

- **Email** — [Resend](https://resend.com)
- **SMS** — [Arkesel](https://arkesel.com) (Ghana)

Sends are fire-and-forget: a notification failure never rolls back or blocks the action that triggered it. Password resets and organization welcome messages go out on both channels, so a bad address on one doesn't leave someone locked out.

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js + Express |
| Database | MySQL 8 |
| ORM | Prisma |
| Auth | JWT (access + refresh), bcrypt hashing |
| Real-time | Socket.IO |
| Payments | Paystack |
| Email / SMS | Resend / Arkesel |

---

## Security

- **Password hashing** — bcrypt, cost factor 12. Plaintext passwords are never stored or logged.
- **Password reset** — tokens are stored as SHA-256 hashes, time-boxed (30 minutes), and single-use. Issuing a new token invalidates any outstanding one.
- **Account enumeration** — forgot-password responses are identical whether or not an account exists.
- **Refresh token invalidation** — changing a password sets `password_changed_at`; refresh tokens issued before that timestamp are rejected, forcing re-login everywhere.
- **Rate limiting** — public endpoints (registration requests, contact form, guest bookings, login) are rate limited per IP, with separate thresholds per endpoint type.
- **CORS** — restricted to a configured origin, for both HTTP and WebSocket connections.
- **Role separation** — a Super Admin can manage Org Admin accounts but the endpoint cannot target another Super Admin or a plain staff account, regardless of the id supplied.

---

## Running locally

### Prerequisites

- Node.js 18+
- MySQL 8+

### Setup

```bash
git clone <this-repo>
cd queue-saas-app
npm install
```

Create a `.env` file in the project root:

```ini
DATABASE_URL="mysql://user:password@localhost:3306/queue_saas"

PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

JWT_ACCESS_SECRET=<long random string>
JWT_REFRESH_SECRET=<a different long random string>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

RESEND_API_KEY=<your Resend key>
ARKESEL_API_KEY=<your Arkesel key>
ARKESEL_SENDER_ID=<your approved sender id, 11 chars max>

PAYSTACK_SECRET_KEY=<your Paystack secret key>
```

Create the database and apply the schema:

```bash
# Create an empty database first
mysql -u root -p -e "CREATE DATABASE queue_saas;"

# Apply the Prisma migration
npx prisma migrate deploy

# Generate the Prisma client
npx prisma generate
```

Seed the reference data the platform needs (roles, business types, plans) and create the first Super Admin:

```bash
node prisma/seed.js
```

The Super Admin is only created if these are set in `.env` — deliberately, so no default credentials ship with the code:

```ini
SUPER_ADMIN_EMAIL=you@example.com
SUPER_ADMIN_PASSWORD=<a strong password>
SUPER_ADMIN_NAME=Platform Administrator
```

The seed is idempotent — safe to run on every deploy without duplicating data or overwriting an existing admin.

Start the server:

```bash
npm run dev
```

The API listens on `http://localhost:4000`, with a health check at `/api/v1/health`.

---

## API overview

All routes are prefixed `/api/v1`.

| Area | Routes |
|---|---|
| Auth (staff/admin) | `/auth/login`, `/auth/refresh`, `/auth/me`, `/auth/forgot-password`, `/auth/reset-password` |
| Customers | `/customers/register`, `/customers/login`, `/customers/me`, `/customers/lookup` |
| Organizations | `/organizations`, `/organizations/public`, `/organizations/me` |
| Branches / Services | `/branches`, `/services` |
| Bookings | `/bookings`, `/bookings/mine`, `/bookings/guest` |
| Queue | `/queue/check-in`, `/queue/call-next`, `/queue/board`, `/queue/track/:uuid` |
| Analytics / Reports | `/analytics/*`, `/reports/*` |
| Support | `/support`, `/support/mine`, `/support/inbox` |
| Platform (Super Admin) | `/organization-requests`, `/platform-users/org-admins` |

Public endpoints (no authentication): organization search, guest booking, ticket tracking, registration requests, and the contact form.

---

## Project structure

```
prisma/
├── schema.prisma    data model — the source of truth for the DB structure
├── migrations/      versioned schema migrations
└── seed.js          seeds roles, business types, plans, first admin

src/
├── config/          database client, environment loading
├── controllers/     request handling and business logic
├── middleware/      auth, tenant scoping, roles, rate limiting, errors
├── routes/          route definitions and middleware chains
├── services/        notifications, tokens, audit logging, Paystack
├── utils/           JWT, hashing, serialization helpers
├── app.js           Express app (no listener — testable in isolation)
├── server.js        HTTP server + Socket.IO startup
└── socket.js        real-time rooms and event emitters
```

`app.js` and `server.js` are deliberately separate so the app can be imported and tested without binding a port.

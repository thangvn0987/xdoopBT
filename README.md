# xdoopBT

Subscription demo with proration upgrade:

- Backend: learner-service exposes endpoints under `/api/learners/subscriptions/*` for plans, current subscription, choose, cancel-at-period-end, and upgrade with pro‑rated charge.
- Frontend: visit `/plans` after login to pick a plan or upgrade. Demo payments activate immediately, with no real gateway.

Key flows:

- Initial subscribe: choose a plan, subscription starts immediately with a 30‑day cycle.
- Schedule cancel: sets “will cancel at end of cycle”.
- Upgrade with pending cancellation: upgrade overrides the pending cancel and charges only the price difference prorated by remaining days.

Notes:

- Database schema is initialized in `database/init/004_subscriptions.sql`. If your Postgres volume already exists, the learner-service will defensively ensure the minimal tables on startup.

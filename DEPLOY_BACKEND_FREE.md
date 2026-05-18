# Deploy RedCart Backend For Free

This backend is an Express + TypeScript API using Prisma and PostgreSQL.

## Recommended Free Setup

- Backend API: Render Free Web Service.
- Database: Neon Free or Supabase Free Postgres.
- Frontend: keep the existing Vercel deployment and point `VITE_API_URL` to the backend URL.

Render also offers Free Postgres, but it expires after 30 days, so use it only for quick testing.

## 1. Create A Free Postgres Database

Use one of these:

- Neon: create a free Postgres project, then copy the pooled connection string.
- Supabase: create a free project, then use the Prisma/Supavisor connection string.

Your final `DATABASE_URL` should look like a normal PostgreSQL URL and include SSL when your provider requires it:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
```

## 2. Push The Backend To GitHub

Do not commit `.env`, `node_modules`, `dist`, or uploaded files. This folder now includes a backend `.gitignore` for those.

If you push both frontend and backend in one repository, set Render's root directory to:

```txt
redcart-backend-main
```

## 3. Create The Render Web Service

In Render:

```txt
New > Web Service
Runtime: Node
Plan: Free
Region: choose the same region as your database if possible
Build Command: npm ci && npx prisma generate && npm run build
Start Command: npm run start:migrate
Health Check Path: /api/v1/health
```

If Render detects `render.yaml`, it can fill most of this automatically.

## 4. Add Environment Variables In Render

Set these first:

```env
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-chars
JWT_EXPIRES_IN=2h
CLIENT_URL=https://your-frontend.vercel.app,https://your-frontend-*.vercel.app
DB_STARTUP_MAX_RETRIES=12
DB_STARTUP_RETRY_MS=3000
PRISMA_CLIENT_ENGINE_TYPE=library
```

For payments/email, keep these disabled until you have real credentials:

```env
MPESA_ENABLED=false
MPESA_ENV=sandbox
MPESA_TRANSACTION_TYPE=CustomerPayBillOnline
SMTP_ENABLED=false
SMTP_FORCE_IPV4=true
EMAIL_PROVIDER=resend
```

Render Free blocks common SMTP ports, so use `EMAIL_PROVIDER=resend` with a `RESEND_API_KEY` when you want receipt emails.

## 5. Deploy And Check Health

After deploy, open:

```txt
https://your-render-service.onrender.com/api/v1/health
```

You should see:

```json
{ "status": "ok", "service": "RedCart API" }
```

## 6. Point Vercel Frontend To The Backend

In Vercel project settings, set:

```env
VITE_API_URL=https://your-render-service.onrender.com/api/v1
```

Then redeploy the frontend.

## Notes

- Render Free spins down after idle time, so the first request after inactivity can be slow.
- Render Free has an ephemeral filesystem. Do not rely on local uploaded files for production product images.
- To seed demo data, set your local `DATABASE_URL` to the remote database and run `npm run prisma:seed` carefully.

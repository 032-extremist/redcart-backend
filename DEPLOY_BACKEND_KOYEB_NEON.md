# Deploy RedCart Backend On Koyeb With Neon Postgres

This is the recommended non-Render free setup for this backend:

- Backend API: Koyeb free web service.
- Database: Neon free Postgres.
- Frontend: keep Vercel and point `VITE_API_URL` to the Koyeb backend URL.

## Why This Combo

Koyeb has one free web service, which is enough for this Express API. Neon has free Postgres with no time limit and no credit card required, which fits Prisma better than short-lived trial databases.

Koyeb also has a free Postgres option, but it is limited to 5 hours of active compute time per month, so it is better for quick testing than for an e-commerce backend.

## 1. Create The Database On Neon

1. Go to Neon and create a free project.
2. Choose a region close to your backend. For Koyeb free hosting, Frankfurt is a good match.
3. Copy the pooled PostgreSQL connection string.

It should look like:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

## 2. Create The Koyeb Web Service

In Koyeb:

```txt
Create Web Service
Deployment method: GitHub
Repository: your RedCart repo
Branch: main
Builder: Buildpack
Work directory: redcart-backend-main
Instance: Free
Region: Frankfurt if available
```

Use these commands:

```txt
Build command: npx prisma generate && npm run build
Run command: npm run start:migrate
```

The backend folder also includes a `Procfile` with the same run command:

```txt
web: npm run start:migrate
```

## 3. Add Environment Variables In Koyeb

Set:

```env
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-chars
JWT_EXPIRES_IN=2h
CLIENT_URL=https://your-vercel-frontend.vercel.app,https://your-vercel-frontend-*.vercel.app
DB_STARTUP_MAX_RETRIES=12
DB_STARTUP_RETRY_MS=3000
PRISMA_CLIENT_ENGINE_TYPE=library
MPESA_ENABLED=false
SMTP_ENABLED=false
EMAIL_PROVIDER=resend
```

For `JWT_SECRET`, use a long random value. Do not reuse the example value.

## 4. Deploy And Test

After deployment, Koyeb will give you a public URL. Test:

```txt
https://your-koyeb-app.koyeb.app/api/v1/health
```

Expected response:

```json
{ "status": "ok", "service": "RedCart API" }
```

## 5. Point Vercel To Koyeb

In Vercel, open your frontend project:

```txt
Settings > Environment Variables
```

Set:

```env
VITE_API_URL=https://your-koyeb-app.koyeb.app/api/v1
```

Then redeploy the frontend.

## Useful Notes

- Koyeb's free web service has limited CPU/RAM, so expect it to be for portfolio/demo traffic, not a high-traffic store.
- Do not store product uploads on the API filesystem long term. Use hosted image URLs or object storage later.
- Prisma migrations run automatically through `npm run start:migrate` when the service starts.

# Deploy RedCart Backend On Netlify With Neon Postgres

Use this when Render and Koyeb are not options because they ask for a card.

- Backend API: Netlify Free plan.
- Database: Neon Free Postgres.
- Frontend: keep Vercel and point `VITE_API_URL` to the Netlify backend URL.

Netlify Free is advertised as free with no credit card required. Neon Free also says no credit card is required.

## 1. Create The Database On Neon

1. Create a free Neon project.
2. Copy the pooled PostgreSQL connection string.
3. Use it as `DATABASE_URL`.

Example shape:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

## 2. Create The Netlify Site

In Netlify:

```txt
Add new project > Import an existing project
Provider: GitHub
Repository: your RedCart repo
Base directory: leave blank, or use .
Build command: npm run prisma:deploy && npx prisma generate && npm run build
Publish directory: public
Functions directory: netlify/functions
```

Use `redcart-backend-main` as the base directory only if this backend folder is inside a larger repository. If you are deploying `https://github.com/032-extremist/redcart-backend`, leave the base directory empty or set it to `.` because the repo root is already the backend.

This folder includes `netlify.toml`, so Netlify can also read those settings automatically.

## 3. Add Environment Variables In Netlify

Open:

```txt
Site configuration > Environment variables
```

Add:

```env
NODE_ENV=production
NPM_FLAGS=--include=dev
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

`NPM_FLAGS=--include=dev` is required because this backend compiles TypeScript on Netlify. Without it, `NODE_ENV=production` makes Netlify skip `devDependencies`, including the TypeScript type packages used by `npm run build`.

## 4. Deploy And Test

After the deploy finishes, open:

```txt
https://your-netlify-site.netlify.app/api/v1/health
```

Expected response:

```json
{ "status": "ok", "service": "RedCart API" }
```

## 5. Point Vercel Frontend To Netlify

In Vercel, set this frontend environment variable:

```env
VITE_API_URL=https://your-netlify-site.netlify.app/api/v1
```

Then redeploy the frontend.

## Notes

- Netlify runs this Express app as a serverless function, not an always-on server.
- Prisma migrations run during Netlify's build using `npm run prisma:deploy`.
- Use Neon's pooled connection string to avoid too many database connections from serverless functions.
- Netlify Function disk storage is temporary. Product images uploaded through the admin panel can disappear after a cold start, so use hosted image URLs or object storage for production images.
- If you need demo products/users, run `npm run prisma:seed` against the Neon database once.

# RepoTutor GitHub App and PostgreSQL setup

The application code separates GitHub user authorization from GitHub App installation:

1. Auth.js uses the GitHub App OAuth client ID and secret to identify the user.
2. After login, the user installs the GitHub App and selects repositories.
3. The setup callback verifies the installation against the signed-in user's GitHub user access token.
4. Repository analysis uses a short-lived installation access token generated only on the server.

## Local environment

Copy `.env.example` to `.env.local` and fill in the values. Never add `NEXT_PUBLIC_` to a secret.

Generate the Auth.js secret:

```powershell
npx auth secret
```

Generate a 32-byte token-encryption key:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

After PostgreSQL is available, create the schema:

```powershell
npm run db:generate
npm run db:migrate
```

Production deployment should run `npm run db:deploy` rather than `db:migrate`.

## Supabase

Create a Supabase project and copy the PostgreSQL connection strings from **Project Settings → Database**.

- `DATABASE_URL`: runtime connection. Use Supabase's pooler connection when deploying to serverless infrastructure.
- `DIRECT_DATABASE_URL`: direct database connection used for Prisma migrations.
- Ensure SSL is enabled in the copied connection strings.
- URL-encode special characters in the database password.

The Prisma runtime uses the `pg` driver adapter, so no Supabase JavaScript client or service-role key is required.

## GitHub App

Create separate GitHub Apps for local development and production.

Development settings:

- Homepage URL: `http://localhost:3000`
- User authorization callback URL: `http://localhost:3000/api/auth/callback/github`
- Setup URL: `http://localhost:3000/api/github/installations/callback`
- Request user authorization during installation: **disabled** (login and installation are intentionally separate)
- Redirect on update: **disabled** for this phase; users can use **목록 동기화** after changing repository selections
- Webhooks: **disabled** for this phase

Permissions:

- Account permission: Email addresses — Read-only
- Repository permission: Contents — Read-only
- Repository metadata is granted read-only by GitHub
- Pull requests, checks, issues, administration and webhook permissions: none

Choose **Any account** if users outside the app owner's account must install the app. Copy these values:

- Client ID → `AUTH_GITHUB_ID`
- Client secret → `AUTH_GITHUB_SECRET`
- App ID → `GITHUB_APP_ID`
- URL slug from `https://github.com/apps/<slug>` → `GITHUB_APP_SLUG`

Generate a GitHub App private key, encode the complete PEM file as base64, and set the result as `GITHUB_APP_PRIVATE_KEY_BASE64`.

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('path-to-private-key.pem'))
```

For production, replace all localhost URLs with the exact HTTPS origin. Do not enable wildcard callback URLs.

## Existing public analysis

`/repository` and `/api/analyze?source=github&url=...` remain public. `GITHUB_TOKEN` is optional and is used only as the existing server-side token for anonymous public repository analysis.

Connected repositories use `/api/repositories/:connectionId/analyze` and always require:

- an Auth.js session;
- a `UserRepository` record owned by that session user;
- an active, non-suspended GitHub installation; and
- a server-generated installation access token.

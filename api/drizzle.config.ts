import { defineConfig } from 'drizzle-kit';

// `generate` does not need a live database; `DATABASE_URL` is required only by
// db:migrate / the running app. The fallback keeps local generation hermetic.
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/handshake';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});

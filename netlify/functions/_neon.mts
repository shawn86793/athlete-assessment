import { neon } from '@neondatabase/serverless'

export type SqlClient = ReturnType<typeof neon>

export const getDatabaseUrl = () =>
  Netlify.env.get('NETLIFY_DATABASE_URL') ||
  Netlify.env.get('NEON_DATABASE_URL') ||
  Netlify.env.get('DATABASE_URL') ||
  ''

export const getSqlClient = (): SqlClient | null => {
  const databaseUrl = getDatabaseUrl()
  if (!databaseUrl) return null
  return neon(databaseUrl)
}

export const ensureSchema = async (sql: SqlClient) => {
  await sql`
    create table if not exists tryouts (
      user_id text not null,
      id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (user_id, id)
    )
  `
  await sql`
    create index if not exists tryouts_user_id_idx
    on tryouts (user_id)
  `
  await sql`
    create table if not exists teams (
      user_id text not null,
      id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (user_id, id)
    )
  `
  await sql`
    create index if not exists teams_user_id_idx
    on teams (user_id)
  `
  await sql`
    create table if not exists seasons (
      user_id text not null,
      id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (user_id, id)
    )
  `
  await sql`
    create index if not exists seasons_user_id_idx
    on seasons (user_id)
  `
}

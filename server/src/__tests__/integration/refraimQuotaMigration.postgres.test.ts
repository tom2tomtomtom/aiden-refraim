import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client, QueryResultRow } from 'pg';

const testDatabaseUrl = process.env.REFRAIM_PG_TEST_URL;
const describePostgres = testDatabaseUrl ? describe : describe.skip;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const VIDEO_ONE = '22222222-2222-4222-8222-222222222221';
const VIDEO_TWO = '22222222-2222-4222-8222-222222222222';
const JOB_ONE = '33333333-3333-4333-8333-333333333331';
const JOB_TWO = '33333333-3333-4333-8333-333333333332';

async function serviceQuery<T extends QueryResultRow = any>(
  client: Client,
  text: string,
  values: unknown[] = [],
) {
  await client.query('SET ROLE service_role');
  try {
    return await client.query<T>(text, values);
  } finally {
    await client.query('RESET ROLE');
  }
}

describePostgres('refrAIm quota migration PostgreSQL smoke', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query(`
      DO $roles$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN;
        END IF;
      END;
      $roles$;

      DROP SCHEMA IF EXISTS refraim CASCADE;
      CREATE SCHEMA refraim;

      CREATE TABLE refraim.videos (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        status TEXT NOT NULL,
        platform_outputs JSONB,
        processing_metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE refraim.processing_jobs (
        id UUID PRIMARY KEY,
        video_id UUID NOT NULL REFERENCES refraim.videos(id),
        user_id UUID NOT NULL,
        platforms TEXT[] NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE refraim.user_billing (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL UNIQUE,
        exports_this_month INTEGER NOT NULL DEFAULT 0,
        exports_reset_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      GRANT USAGE ON SCHEMA refraim TO service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA refraim TO service_role;
    `);

    const migration = readFileSync(resolve(
      __dirname,
      '../../../supabase/migrations/20260718130500_crash_safe_refraim_quota.sql',
    ), 'utf8');
    await admin.query(migration);
  });

  afterAll(async () => {
    await admin?.end();
  });

  beforeEach(async () => {
    await admin.query(`
      TRUNCATE TABLE
        refraim.export_quota_reservations,
        refraim.processing_jobs,
        refraim.videos,
        refraim.user_billing
      CASCADE
    `);
  });

  it('exposes invoker RPCs only to service_role', async () => {
    const privileges = await admin.query(`
      SELECT
        has_function_privilege(
          'anon',
          'refraim.reserve_refraim_export(uuid,uuid,integer)',
          'EXECUTE'
        ) AS anon_reserve,
        has_function_privilege(
          'authenticated',
          'refraim.reserve_refraim_export(uuid,uuid,integer)',
          'EXECUTE'
        ) AS authenticated_reserve,
        has_function_privilege(
          'service_role',
          'refraim.reserve_refraim_export(uuid,uuid,integer)',
          'EXECUTE'
        ) AS service_reserve,
        has_function_privilege(
          'anon',
          'refraim.recover_refraim_plan_quota_export(uuid,uuid,uuid,boolean)',
          'EXECUTE'
        ) AS anon_recover,
        has_function_privilege(
          'authenticated',
          'refraim.recover_refraim_plan_quota_export(uuid,uuid,uuid,boolean)',
          'EXECUTE'
        ) AS authenticated_recover,
        has_function_privilege(
          'service_role',
          'refraim.recover_refraim_plan_quota_export(uuid,uuid,uuid,boolean)',
          'EXECUTE'
        ) AS service_recover
    `);

    expect(privileges.rows[0]).toEqual({
      anon_reserve: false,
      authenticated_reserve: false,
      service_reserve: true,
      anon_recover: false,
      authenticated_recover: false,
      service_recover: true,
    });

    const functions = await admin.query(`
      SELECT p.proname, p.prosecdef, p.proconfig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'refraim'
         AND p.proname IN (
           'reserve_refraim_export',
           'recover_refraim_plan_quota_export'
         )
       ORDER BY p.proname
    `);
    expect(functions.rows).toEqual([
      {
        proname: 'recover_refraim_plan_quota_export',
        prosecdef: false,
        proconfig: ['search_path=""'],
      },
      {
        proname: 'reserve_refraim_export',
        prosecdef: false,
        proconfig: ['search_path=""'],
      },
    ]);
  });

  it('serializes two first-of-period reservations without erasing either increment', async () => {
    await admin.query(`
      INSERT INTO refraim.user_billing (
        id, user_id, exports_this_month, exports_reset_at
      ) VALUES (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '${USER_ID}',
        3,
        now() - interval '31 days'
      );
      INSERT INTO refraim.videos (id, user_id, status) VALUES
        ('${VIDEO_ONE}', '${USER_ID}', 'processing'),
        ('${VIDEO_TWO}', '${USER_ID}', 'processing');
      INSERT INTO refraim.processing_jobs (
        id, video_id, user_id, status
      ) VALUES
        ('${JOB_ONE}', '${VIDEO_ONE}', '${USER_ID}', 'reserving_plan_quota'),
        ('${JOB_TWO}', '${VIDEO_TWO}', '${USER_ID}', 'reserving_plan_quota');
    `);

    const first = new Client({ connectionString: testDatabaseUrl });
    const second = new Client({ connectionString: testDatabaseUrl });
    await Promise.all([first.connect(), second.connect()]);
    try {
      const results = await Promise.all([
        serviceQuery<{ result: { reserved: boolean; used: number } }>(
          first,
          'SELECT refraim.reserve_refraim_export($1,$2,$3) AS result',
          [JOB_ONE, USER_ID, 3],
        ),
        serviceQuery<{ result: { reserved: boolean; used: number } }>(
          second,
          'SELECT refraim.reserve_refraim_export($1,$2,$3) AS result',
          [JOB_TWO, USER_ID, 3],
        ),
      ]);

      expect(results.map(result => result.rows[0].result.reserved)).toEqual([true, true]);
      expect(results.map(result => result.rows[0].result.used).sort()).toEqual([1, 2]);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }

    const durable = await admin.query(`
      SELECT
        b.exports_this_month,
        count(r.job_id)::int AS receipts,
        count(DISTINCT r.quota_period_started_at)::int AS periods,
        count(*) FILTER (WHERE j.status = 'processing_plan_quota')::int AS active_jobs
      FROM refraim.user_billing b
      JOIN refraim.export_quota_reservations r ON r.user_id = b.user_id
      JOIN refraim.processing_jobs j ON j.id = r.job_id
      WHERE b.user_id = $1
      GROUP BY b.exports_this_month
    `, [USER_ID]);
    expect(durable.rows[0]).toEqual({
      exports_this_month: 2,
      receipts: 2,
      periods: 1,
      active_jobs: 2,
    });
  });

  it('refunds by the atomic reservation period, not the earlier job creation timestamp', async () => {
    await admin.query(`
      INSERT INTO refraim.user_billing (
        id, user_id, exports_this_month, exports_reset_at
      ) VALUES (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '${USER_ID}',
        3,
        now() - interval '31 days'
      );
      INSERT INTO refraim.videos (
        id, user_id, status, processing_metadata
      ) VALUES (
        '${VIDEO_ONE}',
        '${USER_ID}',
        'processing',
        jsonb_build_object('active_job_id', '${JOB_ONE}', 'publication_state', 'active')
      );
      INSERT INTO refraim.processing_jobs (
        id, video_id, user_id, status, created_at, updated_at
      ) VALUES (
        '${JOB_ONE}',
        '${VIDEO_ONE}',
        '${USER_ID}',
        'reserving_plan_quota',
        now() - interval '40 days',
        now() - interval '40 days'
      );
    `);

    const reserved = await serviceQuery<{ result: { reserved: boolean; used: number } }>(
      admin,
      'SELECT refraim.reserve_refraim_export($1,$2,$3) AS result',
      [JOB_ONE, USER_ID, 3],
    );
    expect(reserved.rows[0].result).toEqual(expect.objectContaining({ reserved: true, used: 1 }));

    const recovered = await serviceQuery<{ result: { recovered: boolean; refunded: boolean } }>(
      admin,
      'SELECT refraim.recover_refraim_plan_quota_export($1,$2,$3,false) AS result',
      [USER_ID, VIDEO_ONE, JOB_ONE],
    );
    expect(recovered.rows[0].result).toEqual({ recovered: true, refunded: true });

    const replay = await serviceQuery<{ result: { recovered: boolean; refunded: boolean } }>(
      admin,
      'SELECT refraim.recover_refraim_plan_quota_export($1,$2,$3,false) AS result',
      [USER_ID, VIDEO_ONE, JOB_ONE],
    );
    expect(replay.rows[0].result).toEqual({ recovered: true, refunded: true });

    const billing = await admin.query(
      'SELECT exports_this_month FROM refraim.user_billing WHERE user_id = $1',
      [USER_ID],
    );
    expect(billing.rows[0].exports_this_month).toBe(0);
  });
});

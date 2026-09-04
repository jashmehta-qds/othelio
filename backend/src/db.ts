import pg from "pg";
export const createDb = (connectionString: string) => new pg.Pool({ connectionString, max: 10, statement_timeout: 10_000 });
export type Database = ReturnType<typeof createDb>;

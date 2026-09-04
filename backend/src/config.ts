import { z } from "zod";
const schema = z.object({DATABASE_URL:z.string().url(),API_HOST:z.string().default("0.0.0.0"),API_PORT:z.coerce.number().int().positive().default(3001),CORS_ORIGIN:z.string().default("http://localhost:3000")});
export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);

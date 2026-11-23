import "dotenv/config";
import { defineConfig, env } from "prisma/config";
import { checkedDatabaseUrl } from "./src/lib/databaseTls";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: checkedDatabaseUrl(process.env.DIRECT_DATABASE_URL || env("DATABASE_URL"), "prisma") },
});

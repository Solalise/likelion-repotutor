import type { FileAnalysis } from "@/types/analysis";
import type { PackageManifest, TechnologyStack } from "@/types/technology";

export function identifyTechnology(files: FileAnalysis[], manifests: PackageManifest[] = []): TechnologyStack {
  const evidence: TechnologyStack["evidence"] = manifests.flatMap(m => m.dependencies.map(pkg => ({ package: pkg, source: m.path, kind: "dependency" as const })));
  for (const file of files) for (const item of file.imports) if (!item.source.startsWith(".") && !item.source.startsWith("@/")) evidence.push({ package: item.source.startsWith("@") ? item.source.split("/").slice(0, 2).join("/") : item.source.split("/")[0], source: file.path, kind: "import" });
  const packages = new Set(evidence.map(e => e.package));
  const select = (mapping: Record<string, string>) => [...new Set(Object.entries(mapping).filter(([pkg]) => packages.has(pkg)).map(([, label]) => label))];
  return { evidence, frameworks: select({ next: "Next.js", react: "React", express: "Express", fastify: "Fastify", koa: "Koa", nuxt: "Nuxt", vue: "Vue" }),
    databases: select({ mongoose: "MongoDB", mongodb: "MongoDB", pg: "PostgreSQL", mysql: "MySQL", mysql2: "MySQL", sqlite3: "SQLite", "better-sqlite3": "SQLite" }),
    persistence: select({ mongoose: "Mongoose (ODM)", "@prisma/client": "Prisma (ORM)", sequelize: "Sequelize (ORM)", typeorm: "TypeORM", "drizzle-orm": "Drizzle ORM" }),
    notes: ["의존성·import 관찰이며 실제 배포 DB 또는 실행 환경의 증명은 아닙니다. Prisma 의존성만으로 DB 종류를 추정하지 않습니다.", ...manifests.filter(m => m.error).map(m => `${m.path}: ${m.error}`)] };
}

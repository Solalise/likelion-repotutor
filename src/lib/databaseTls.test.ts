import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkedDatabaseUrl } from "./databaseTls";
const ca=resolve("certs/supabase-prod-ca-2021.crt");
function url(driver:"pg"|"prisma"="pg",host="aws-0-example.pooler.supabase.com") {
  const value=new URL(`postgresql://postgres.example:fixture-password@${host}:${driver==="pg"?6543:5432}/postgres`);
  value.searchParams.set("sslmode",driver==="pg"?"verify-full":"require");
  value.searchParams.set(driver==="pg"?"sslrootcert":"sslcert",ca);
  if(driver==="prisma")value.searchParams.set("sslaccept","strict");
  return value;
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("strict Supabase runtime and schema-engine TLS configuration",()=>{
  it.each(["pg","prisma"] as const)("accepts %s's verified CA configuration without changing targets or credentials",driver=>{
    const value=url(driver).toString();expect(checkedDatabaseUrl(value,driver,{})).toBe(value);
  });
  it.each(["disable","prefer","require","verify-ca","no-verify"])("blocks runtime sslmode=%s",mode=>{
    const value=url();value.searchParams.set("sslmode",mode);expect(()=>checkedDatabaseUrl(value.toString(),"pg",{})).toThrow("DB_TLS_STRICT_SETTINGS_REQUIRED");
  });
  it("requires the schema engine's strict verification separately from pg verify-full",()=>{
    expect(()=>checkedDatabaseUrl(url("pg").toString(),"prisma",{})).toThrow();
    const value=url("prisma");value.searchParams.set("sslaccept","accept_invalid_certs");expect(()=>checkedDatabaseUrl(value.toString(),"prisma",{})).toThrow("DB_TLS_STRICT_SETTINGS_REQUIRED");
    value.searchParams.delete("sslaccept");expect(()=>checkedDatabaseUrl(value.toString(),"prisma",{})).toThrow();
  });
  it.each(["ssl","sslkey","sslcert","sslidentity","sslnegotiation","uselibpqcompat"])("rejects conflicting runtime URL option %s",key=>{
    const value=url();value.searchParams.set(key,"fixture");expect(()=>checkedDatabaseUrl(value.toString(),"pg",{})).toThrow("DB_TLS_SETTINGS_UNSAFE");
  });
  it("rejects duplicate and destination-override parameters",()=>{
    const value=url();value.searchParams.append("sslmode","disable");expect(()=>checkedDatabaseUrl(value.toString(),"pg",{})).toThrow("DB_CONNECTION_URL_AMBIGUOUS");
    for(const key of ["host","hostaddr","port","user","password"]) {const value=url();value.searchParams.set(key,"fixture");expect(()=>checkedDatabaseUrl(value.toString(),"pg",{})).toThrow("DB_CONNECTION_TARGET_OVERRIDE");}
  });
  it("rejects missing, unreadable and expired CAs without exposing connection strings",()=>{
    const value=url();value.searchParams.delete("sslrootcert");expect(()=>checkedDatabaseUrl(value.toString(),"pg",{})).toThrow("DB_TLS_CA_REQUIRED");
    value.searchParams.set("sslrootcert",resolve("certs/not-present.crt"));expect(()=>checkedDatabaseUrl(value.toString(),"pg",{})).toThrow("DB_TLS_CA_INVALID_OR_UNREADABLE");
    vi.useFakeTimers();vi.setSystemTime(new Date("2032-01-01"));expect(()=>checkedDatabaseUrl(url().toString(),"pg",{})).toThrow("DB_TLS_CA_INVALID_OR_UNREADABLE");
  });
  it("rejects global verification bypass and CLI transaction pooling",()=>{
    expect(()=>checkedDatabaseUrl(url().toString(),"pg",{NODE_TLS_REJECT_UNAUTHORIZED:"0"})).toThrow("DB_TLS_VERIFICATION_DISABLED");
    const value=url("prisma");value.port="6543";expect(()=>checkedDatabaseUrl(value.toString(),"prisma",{})).toThrow("DB_CLI_SESSION_CONNECTION_REQUIRED");
  });
  it("does not change the existing localhost sample or disclose malformed URL input",()=>{
    const local="postgresql://postgres:fixture@localhost:5432/repotutor";expect(checkedDatabaseUrl(local,"pg",{})).toBe(local);
    try {checkedDatabaseUrl("invalid-fixture-password-url","pg",{});}catch(error){expect((error as Error).message).toBe("DB_CONNECTION_URL_INVALID");}
  });
});

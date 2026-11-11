"use client";
import { useState } from "react";
import Link from "next/link";
export function GitHubSummary() {
  const [rows,setRows] = useState<{id:string;repository:{fullName:string;defaultBranch:string}}[]>();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function load() {
    setBusy(true);setError("");setRows(undefined);
    try { const response=await fetch("/api/github/repositories",{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error(response.status===401?"GitHub 로그인 후 연결 정보를 확인할 수 있습니다.":"GitHub 권한을 확인하지 못했습니다. 연결 관리에서 다시 확인해주세요.");
      setRows(await response.json());
    }catch(error){setError(error instanceof Error?error.message:"연결 정보를 확인하지 못했습니다.");}finally{setBusy(false);}
  }
  return <div><button className="bp-secondary" disabled={busy} onClick={()=>void load()}>{busy?"GitHub 권한 확인 중…":"기존 API로 연결 상태 확인"}</button>{error&&<p role="alert">{error}</p>}{rows&&<><p role="status">마지막 조회에서 접근 가능한 연결 저장소 {rows.length}개를 확인했습니다.</p><ul className="bp-records">{rows.map(row=><li key={row.id}><div><strong>{row.repository.fullName}</strong><span className="bp-muted">{row.repository.defaultBranch}</span></div><Link href={`/practice?${new URLSearchParams({connectionId:row.id})}`}>실습에 참고 연결 →</Link></li>)}</ul></>}</div>;
}

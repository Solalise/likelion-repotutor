"use client";

import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from "react";
import { Server } from "lucide-react";
import { LabSessionProvider } from "@/components/security/LabSession";

type Service = { id: string; name: string; port: number };
type Registry = { services: Service[]; selectedId: string | null };
const STORAGE_KEY = "vulnlab.services.v1";
const empty: Registry = { services: [], selectedId: null };
const Context = createContext<{
  registry: Registry; ready: boolean; message: string;
  save: (next: Registry, message: string) => boolean;
} | null>(null);

export function useRegistry() {
  const value = useContext(Context);
  if (!value) throw new Error("ServiceRegistry is required");
  return value;
}

export function ServiceRegistry({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<Registry>(empty);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as Registry;
        if (!data || !Array.isArray(data.services) || !data.services.every(service =>
          service && typeof service.id === "string" && service.id.length > 0 &&
          typeof service.name === "string" && service.name.trim().length > 0 && service.name.length <= 80 &&
          Number.isInteger(service.port) && service.port >= 1 && service.port <= 65535
        ) || new Set(data.services.map(service => service.id)).size !== data.services.length) {
          throw new Error("Invalid registry");
        }
        setRegistry({ services: data.services, selectedId: data.services.some(service => service.id === data.selectedId) ? data.selectedId : null });
      }
    } catch {
      setMessage("저장 정보를 불러오지 못했습니다. 브라우저 저장소 설정을 확인해주세요. 새로 등록하면 저장 정보를 다시 작성합니다.");
    } finally {
      setReady(true);
    }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function save(next: Registry, success: string) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setRegistry(next);
      setMessage(success);
      return true;
    } catch {
      setMessage("저장하지 못했습니다. 브라우저 저장 공간과 저장소 사용 설정을 확인한 뒤 다시 시도해주세요.");
      return false;
    }
  }
  return <LabSessionProvider><Context.Provider value={{ registry, ready, message, save }}>{children}</Context.Provider></LabSessionProvider>;
}

export function ServiceRegistrationForm() {
  const { registry, ready, message, save } = useRegistry();
  const [name, setName] = useState("");
  const [port, setPort] = useState("");
  const [error, setError] = useState("");
  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) {
      setError("서비스 이름을 앞뒤 공백 제외 1~80자로 입력해주세요.");
      return;
    }
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      setError("포트는 1~65535 사이의 정수로 입력해주세요.");
      return;
    }
    const service = { id: crypto.randomUUID(), name: trimmed, port: Number(port) };
    setError("");
    if (save({ services: [...registry.services, service], selectedId: service.id }, "서비스를 등록하고 선택했습니다.")) {
      setName("");
      setPort("");
    }
  }
  return <form onSubmit={register}>
    <p className="vl-description">내가 소유하고 통제하는 로컬 테스트 환경을 등록합니다.</p>
    <label className="vl-field"><span>서비스 이름</span><input value={name} onChange={event => setName(event.target.value)} placeholder="예: 나의 주문 서비스" maxLength={80} required disabled={!ready}/></label>
    <label className="vl-field"><span>로컬 테스트 서버 포트</span><input type="text" inputMode="numeric" value={port} onChange={event => setPort(event.target.value)} placeholder="예: 3001" required disabled={!ready} aria-describedby="service-port-help"/><small id="service-port-help">127.0.0.1의 포트 번호를 입력해주세요. (1~65535)</small></label>
    <div className="vl-inline-note"><p>등록 정보와 선택 상태는 현재 브라우저에 저장됩니다.<br/>서비스 등록은 서버 연결이나 요청을 실행하지 않습니다.</p></div>
    {error && <p className="vl-service-error" role="alert">{error}</p>}
    <button className="vl-button" type="submit" disabled={!ready}>서비스 등록</button>
    <p className="vl-small" role="status">{message}</p>
  </form>;
}

export function RegisteredServices() {
  const { registry, ready, save } = useRegistry();
  if (!ready) return <p className="vl-small" role="status">등록 정보를 불러오는 중입니다.</p>;
  if (!registry.services.length) return <div className="vl-empty"><span className="vl-empty-icon"><Server size={30}/></span><h3>등록된 서비스가 없어요</h3><p>서비스 이름과 로컬 테스트 서버 포트를 입력해 등록해주세요.</p></div>;
  return <ul className="vl-service-list" aria-label="등록된 웹서비스">{registry.services.map(service =>
    <li key={service.id} className={registry.selectedId === service.id ? "is-selected" : ""}>
      <div><strong>{service.name}</strong><span>http://127.0.0.1:{service.port}</span><small>등록됨 · 연결 상태는 로컬 실행기 카드에서 확인</small></div>
      <div className="vl-service-actions"><button type="button" className="vl-outline-button" aria-label={`${service.name} 선택`} aria-pressed={registry.selectedId === service.id} onClick={() => save({ ...registry, selectedId: service.id }, `${service.name} 서비스를 선택했습니다.`)}>{registry.selectedId === service.id ? "선택됨" : "선택"}</button>
        <button type="button" className="vl-outline-button" aria-label={`${service.name} 삭제`} onClick={() => save({ services: registry.services.filter(item => item.id !== service.id), selectedId: registry.selectedId === service.id ? null : registry.selectedId }, `${service.name} 서비스를 삭제했습니다.`)}>삭제</button></div>
    </li>
  )}</ul>;
}

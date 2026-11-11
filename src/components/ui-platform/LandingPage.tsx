import Link from "next/link";
import { ArrowRight, ShieldCheck, Crosshair, Plug, RefreshCw } from "lucide-react";
import { PlatformBrand } from "@/components/ui-platform/PlatformShell";
import { site } from "@/lib/ui/site";
const processSteps = [
  ["01", "내 웹서비스 연결", "내가 통제하는 테스트 환경부터 준비합니다."],
  ["02", "공격 방식 선택", "작은 요청의 차이로 공격 원리를 이해합니다."],
  ["03", "취약점 확인", "응답과 근거를 함께 살펴봅니다."],
  ["04", "수정과 재검증", "원인을 이해하고 같은 조건으로 다시 확인합니다."],
];
export default function HomePage(){return <div className="vl-landing"><header className="vl-landing-header"><PlatformBrand home="/"/><nav aria-label="서비스 안내"><a href="#process">실습 과정</a><Link href="/learn">취약점 학습</Link><Link className="vl-outline-button" href="/overview">워크스페이스 보기 <ArrowRight size={15}/></Link></nav></header>
  <main id="main-content"><section className="vl-landing-hero"><div><span className="vl-eyebrow">UNDERSTAND YOUR SERVICE. BUILD YOUR DEFENSE.</span><h1>내가 만든 서비스,<br/><em>보안을 배우는 실험실.</em></h1><p>작은 공격에서 취약점의 원리를 이해하고,<br/>수정과 재검증으로 더 안전한 서비스를 만들어보세요.</p><div className="vl-actions"><Link className="vl-button" href="/practice">실습 화면 둘러보기 <ArrowRight size={17}/></Link><Link className="vl-outline-button" href="/learn">IDOR 원리 알아보기</Link></div><small>현재는 UI 미리보기 단계입니다. 실제 기능은 연결 전입니다.</small></div><div className="vl-landing-diagram"><div className="vl-diagram-title"><ShieldCheck size={18}/><span>나의 테스트 환경에서 시작하는 보안 학습</span></div><div className="vl-diagram-service"><span>YOUR TEST ENVIRONMENT</span><strong>나의 웹서비스</strong><small>서비스 연결 전 · 화면 안내용</small></div><div className="vl-diagram-pair"><div><Plug size={23}/><strong>테스트 환경</strong><span>내가 통제하는 범위</span></div><div><Crosshair size={23}/><strong>작은 공격</strong><span>원리와 근거의 이해</span></div></div><div className="vl-diagram-bottom"><RefreshCw size={16}/> 이해 → 수정 → 재검증</div></div></section>
  <section id="process" className="vl-landing-section"><span className="vl-eyebrow">A CLEAR PATH TO LEARNING</span><h2>발견에서 끝나지 않는 보안 실습</h2><p>서비스를 연결하는 순간부터 수정 후 다시 확인하는 순간까지, 한 단계씩 배웁니다.</p><ol className="vl-process">{processSteps.map(([number,title,text])=><li key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></li>)}</ol></section>
  <section className="vl-landing-section vl-landing-topic"><div><span className="vl-eyebrow">FIRST TOPIC · IDOR</span><h2>번호를 바꾸면,<br/>다른 사람의 데이터가 보일까요?</h2><p>로그인과 접근권한은 다릅니다. IDOR을 통해 리소스 소유권을 확인하는 이유와 서버에서 보호하는 방법을 알아보세요.</p><Link className="vl-text-link" href="/learn">IDOR 개념 살펴보기 →</Link></div><div className="vl-card"><span className="vl-icon"><BookTopicIcon/></span><h3>단순한 판정 대신, 근거로 이해하기</h3><p>누구의 신원으로 요청했는지, 어떤 데이터를 받았는지, 접근 정책은 무엇인지 함께 살펴보는 학습 흐름입니다.</p><span className="vl-status">실습 기능 연결 예정</span></div></section>
  <section className="vl-landing-section vl-landing-end"><ShieldCheck size={26}/><h2>나의 서비스, 나의 테스트 환경에서.</h2><p>자신이 소유하고 통제하는 환경에서 배우는 웹 보안 플랫폼을 준비합니다.<br/>GitHub는 선택적 소스코드 보조 기능입니다.</p><Link className="vl-outline-button" href="/services">내 웹서비스 화면 보기 <ArrowRight size={16}/></Link></section></main>
  <footer className="vl-landing-footer"><strong>{site.name}</strong><span>{site.tagline}</span><span>UI PREVIEW · 기능 연결 전</span></footer></div>;}
function BookTopicIcon(){return <ShieldCheck size={23}/>;}

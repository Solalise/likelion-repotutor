"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { RepositoryFeature, RepositoryFeatureDiscovery } from "@/types/analysis";
import { buildFeatureNavigation, featureNavigationLabel, searchFeatureNavigation } from "@/lib/features/featureNavigation";

interface FeaturePickerProps {
  discovery: RepositoryFeatureDiscovery;
  selectedFeatureId?: string;
  onSelect: (feature: RepositoryFeature) => void;
}

function FeatureOption({ feature, selected, onSelect }: { feature: RepositoryFeature; selected: boolean; onSelect: (feature: RepositoryFeature) => void }) {
  const label = featureNavigationLabel(feature);
  return <button className={`feature-option${selected ? " is-selected" : ""}`} type="button" aria-pressed={selected} onClick={() => onSelect(feature)}>
    <span className="feature-option-main"><strong>{label.title}</strong>{label.titleInferred && <small>이름 추정</small>}</span>
    {label.summary && <span className="feature-option-description">{label.summary}</span>}
    <code className="feature-option-path">{label.path}</code>
  </button>;
}

export function FeaturePicker({ discovery, selectedFeatureId, onSelect }: FeaturePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const allFeatures = useMemo(() => [...discovery.primary, ...discovery.limited], [discovery]);
  const groups = useMemo(() => buildFeatureNavigation(allFeatures), [allFeatures]);
  const visibleGroups = useMemo(() => searchFeatureNavigation(groups, query), [groups, query]);
  const selected = allFeatures.find((feature) => feature.id === selectedFeatureId);
  const resultCount = visibleGroups.reduce((total, group) => total + group.features.length, 0);

  function choose(feature: RepositoryFeature): void {
    onSelect(feature);
    setOpen(false);
  }

  return <div className="feature-picker">
    <button className="feature-picker-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span><small>선택한 기능</small><strong>{selected ? featureNavigationLabel(selected).title : "분석할 기능 선택"}</strong></span><ChevronDown size={14} />
    </button>
    {open && <div className="feature-picker-popover">
      <div className="feature-search"><Search size={14} /><input value={query} onChange={(event) => { setQuery(event.target.value); setExpanded({}); }} aria-label="기능 검색" placeholder="기능 그룹, 기능명, 함수명, 경로 검색" autoFocus /></div>
      <div className="feature-picker-tools"><span>{visibleGroups.filter((group) => group.id !== "ungrouped").length}개 그룹 · {resultCount}개 코드 진입점</span></div>
      <details className="feature-common-notice"><summary>목록 분류와 정적 분석 안내</summary>
        <p>그룹은 같은 앱의 라우트 폴더를 기준으로 묶은 탐색 단위입니다. 이름 추정은 실제 업무 의미를 확정하지 않습니다. 그룹을 펼쳐도 실행 흐름은 합쳐지지 않습니다.</p>
        <p>정적 코드 관계는 실행 시점·실행 여부·순서를 보장하지 않습니다. 참조·콜백 전달은 실행을 뜻하지 않습니다. 파일 제한으로 일부 관계가 누락될 수 있습니다.</p>
      </details>
      <div className="feature-options">
        {visibleGroups.map((group) => {
          const isExpanded = expanded[group.id] ?? (Boolean(query.trim()) || group.id === "ungrouped" || group.features.some((feature) => feature.id === selectedFeatureId));
          return <section className="feature-navigation-group" key={group.id}>
            <button type="button" className="feature-group-trigger" aria-expanded={isExpanded} onClick={() => setExpanded((current) => ({ ...current, [group.id]: !isExpanded }))}>
              <span><strong>{group.title}</strong>{group.titleInferred && <small>그룹명 추정</small>}<small>{group.features.length}개{group.features.some((feature) => feature.id === selectedFeatureId) ? " · 선택 항목 포함" : ""}</small></span><ChevronDown size={13} aria-hidden="true" />
            </button>
            {group.directory && <code className="feature-group-path">{group.directory}</code>}
            {isExpanded && <div className="feature-group-items">{group.features.map((feature) => <FeatureOption key={feature.id} feature={feature} selected={feature.id === selectedFeatureId} onSelect={choose} />)}</div>}
          </section>;
        })}
        {resultCount === 0 && <div className="feature-empty">검색 조건에 맞는 기능을 찾지 못했습니다.</div>}
      </div>
    </div>}
  </div>;
}

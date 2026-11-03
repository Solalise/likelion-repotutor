"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { RepositoryFeature, RepositoryFeatureDiscovery } from "@/types/analysis";

interface FeaturePickerProps {
  discovery: RepositoryFeatureDiscovery;
  selectedFeatureId?: string;
  onSelect: (feature: RepositoryFeature) => void;
}

function FeatureOption({ feature, onSelect }: { feature: RepositoryFeature; onSelect: (feature: RepositoryFeature) => void }) {
  return (
    <button className="feature-option" type="button" onClick={() => onSelect(feature)}>
      <span className="feature-option-main">
        <strong>{feature.title}</strong>
      </span>
      <span className="feature-option-description">{feature.description}</span>
    </button>
  );
}

export function FeaturePicker({ discovery, selectedFeatureId, onSelect }: FeaturePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const allFeatures = useMemo(
    () => [...discovery.primary, ...discovery.limited],
    [discovery],
  );
  const selected = allFeatures.find((feature) => feature.id === selectedFeatureId);
  const normalizedQuery = query.trim().toLocaleLowerCase("ko");
  const matches = (feature: RepositoryFeature) => !normalizedQuery || [
    feature.title,
    feature.technicalName,
    feature.entryFilePath,
    ...feature.filePaths,
  ].some((value) => value.toLocaleLowerCase("ko").includes(normalizedQuery));
  const primary = discovery.primary.filter(matches);
  const limited = discovery.limited.filter(matches);
  const resultCount = primary.length + limited.length;

  function choose(feature: RepositoryFeature): void {
    onSelect(feature);
    setOpen(false);
  }

  return (
    <div className="feature-picker">
      <button className="feature-picker-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>
          <small>선택한 기능</small>
          <strong>{selected?.title ?? "분석할 기능 선택"}</strong>
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="feature-picker-popover">
          <div className="feature-search">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기능명, 함수명, 파일 경로 검색" autoFocus />
          </div>
          <div className="feature-picker-tools">
            <span>{resultCount}개 사용자 기능</span>
          </div>
          <div className="feature-options">
            {primary.length > 0 && <div className="feature-section-label">확인된 사용자 기능</div>}
            {primary.map((feature) => <FeatureOption key={feature.id} feature={feature} onSelect={choose} />)}
            {limited.length > 0 && <div className="feature-section-label limited">코드 연결 확인이 제한된 기능</div>}
            {limited.map((feature) => <FeatureOption key={feature.id} feature={feature} onSelect={choose} />)}
            {resultCount === 0 && <div className="feature-empty">검색 조건에 맞는 기능을 찾지 못했습니다.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

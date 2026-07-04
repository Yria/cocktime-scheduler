import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasKakaoKey } from "../../../lib/kakaoMap";
import {
	type CarpoolMember,
	fetchCarpoolRoster,
} from "../../../lib/supabase/carpool";
import type {
	CarpoolGroup,
	CarpoolGroups,
	SessionRow,
} from "../../../lib/supabase/types";
import { scheduleActions } from "../../../store/scheduleStore";
import { DEFAULT_FOOTER } from "./announcementText";

/**
 * 카풀 편성 상태 훅 — 명단 로드·배정 상태·파생 memo·자동저장·편성 핸들러.
 * header/footer 는 메인 컴포넌트의 상태를 매 렌더 인자로 받아 자동저장 payload 에 사용한다.
 */
export function useCarpoolAssignment(
	s: SessionRow,
	header: string,
	footer: string,
	auto: string,
) {
	const [roster, setRoster] = useState<CarpoolMember[] | null>(null);
	const [assignment, setAssignment] = useState<Record<string, string>>({});
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [showMap, setShowMap] = useState(true);
	const [mapActive, setMapActive] = useState(() => hasKakaoKey());
	// 마운트 시점의 저장 편성만 사용 — 저장→스토어 갱신으로 prop 이 바뀌어도 편성을 리셋하지 않도록.
	const savedRef = useRef(s.carpool_groups);

	// 명단 로드 + 저장된 편성 재조정(현재 confirmed·role 기준으로만 유지). 마운트 1회.
	useEffect(() => {
		let cancelled = false;
		fetchCarpoolRoster(s.id).then((r) => {
			if (cancelled) return;
			const driverIds = new Set(
				r.filter((m) => m.role === "can_drive").map((m) => m.member_id),
			);
			const riderIds = new Set(
				r.filter((m) => m.role === "need_ride").map((m) => m.member_id),
			);
			const a: Record<string, string> = {};
			for (const g of savedRef.current?.groups ?? []) {
				if (!driverIds.has(g.driver_member_id)) continue;
				for (const rid of g.rider_member_ids) {
					if (riderIds.has(rid) && !(rid in a)) a[rid] = g.driver_member_id;
				}
			}
			setAssignment(a);
			setRoster(r);
			// 처음 입장 시 미배정 동승자가 없으면(전원 배정/동승자 없음) 지도는 기본 접기
			const hasUnassigned = r.some(
				(m) => m.role === "need_ride" && !(m.member_id in a),
			);
			if (!hasUnassigned) setShowMap(false);
		});
		return () => {
			cancelled = true;
		};
	}, [s.id]);

	const drivers = useMemo(
		() => (roster ?? []).filter((m) => m.role === "can_drive"),
		[roster],
	);
	const riders = useMemo(
		() => (roster ?? []).filter((m) => m.role === "need_ride"),
		[roster],
	);
	const ridersByDriver = useMemo(() => {
		const map = new Map<string, CarpoolMember[]>();
		for (const d of drivers) map.set(d.member_id, []);
		for (const r of riders) {
			const did = assignment[r.member_id];
			if (did && map.has(did)) map.get(did)?.push(r);
		}
		return map;
	}, [drivers, riders, assignment]);
	const unassigned = useMemo(
		() => riders.filter((r) => !(r.member_id in assignment)),
		[riders, assignment],
	);
	// 이미 배정된 동승자 id(선택 전 초기 지도에서 미배정만 남기는 데 사용)
	const assignedRiderIds = useMemo(
		() => new Set(Object.keys(assignment)),
		[assignment],
	);
	// 지도 운전자 마커에 표시할 현재 탑승 인원(driver_member_id → 배정 수)
	const assignedCount = useMemo(() => {
		const c: Record<string, number> = {};
		for (const d of drivers)
			c[d.member_id] = ridersByDriver.get(d.member_id)?.length ?? 0;
		return c;
	}, [drivers, ridersByDriver]);
	// 지도가 보이고 사용 가능하면 지도 마커 탭으로 배정 → 카드의 '여기 태우기' 버튼 숨김
	const mapAssign = showMap && mapActive;

	// 편성/헤더/푸터 변경 자동 저장(디바운스, 로드 직후 1회는 스킵)
	const dirtyRef = useRef(false);
	useEffect(() => {
		if (!roster) return;
		if (!dirtyRef.current) {
			dirtyRef.current = true;
			return;
		}
		const t = setTimeout(() => {
			const groups: CarpoolGroup[] = drivers
				.map((d) => ({
					driver_member_id: d.member_id,
					rider_member_ids: (ridersByDriver.get(d.member_id) ?? []).map(
						(r) => r.member_id,
					),
				}))
				.filter((g) => g.rider_member_ids.length > 0);
			const payload: CarpoolGroups = {
				v: 1,
				groups,
				header: header.trim() === auto ? null : header,
				footer: footer === DEFAULT_FOOTER ? null : footer,
			};
			void scheduleActions.saveCarpoolGroups(s.id, payload);
		}, 700);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [assignment, header, footer, roster]);

	const toggleSelect = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
		// 동승자를 고르면 지도에서 주변 운전자를 바로 확인할 수 있게 접힌 지도를 펼친다.
		setShowMap(true);
	};
	const assignSelectedTo = useCallback(
		(driverId: string) => {
			if (selected.size === 0) return;
			setAssignment((prev) => {
				const next = { ...prev };
				for (const id of selected) next[id] = driverId;
				return next;
			});
			setSelected(new Set());
		},
		[selected],
	);
	const removeRider = (id: string) =>
		setAssignment((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});

	return {
		roster,
		drivers,
		riders,
		ridersByDriver,
		unassigned,
		assignedRiderIds,
		assignedCount,
		mapAssign,
		showMap,
		setShowMap,
		setMapActive,
		selected,
		toggleSelect,
		assignSelectedTo,
		removeRider,
	};
}

/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오 지도 SDK는 전역 주입 + 공식 타입 없음 */
import { useEffect, useRef, useState } from "react";
import { geocodeDongs } from "../../../lib/carpool/geocodeResidence";
import { hasKakaoKey, loadKakaoMaps } from "../../../lib/kakaoMap";
import type { CarpoolMember } from "../../../lib/supabase/carpool";

// 운영자 보조 지도 — 운전자/탑승필요자를 거주 동 중심점으로 표시(같은 동은 한 점에 모임).
// 미배정 동승자를 선택하면 지도가 커지고, 동승자는 선택한 사람만 남으며 운전자 마커를 누르면
// 그 차에 배정된다(2탭 버튼 대체). 운전자 마커에는 현재 탑승 인원(있으면 좌석 대비)을 함께 표시.
// 키 없음/지오코딩 실패는 안내로 대체(graceful degrade).

interface Props {
	roster: CarpoolMember[];
	selected?: Set<string>;
	/** 이미 배정된 동승자 id — 선택 전 초기 상태에서는 미배정 동승자만 지도에 남긴다 */
	assignedRiderIds?: Set<string>;
	/** driver_member_id → 현재 배정된 동승자 수 */
	assignedCount?: Record<string, number>;
	/** 선택 모드에서 운전자 마커를 눌렀을 때(선택된 동승자를 이 운전자에 배정) */
	onAssignToDriver?: (driverId: string) => void;
	/** 지도 사용 가능 여부 통지(true=정상 로드, false=키 없음/로드 실패) */
	onReady?: (active: boolean) => void;
}

const SEOUL = { lat: 37.5666, lng: 126.9784 };

interface PinOpts {
	highlighted: boolean; // 선택된 동승자 강조
	clickable: boolean; // 선택 모드의 운전자 → 눌러서 배정
	count?: number; // 운전자 현재 탑승 인원
}

function makePin(m: CarpoolMember, opts: PinOpts): HTMLElement {
	const isDriver = m.role === "can_drive";
	const wrap = document.createElement("div");
	wrap.style.cssText = `display:flex;flex-direction:column;align-items:center;pointer-events:${
		opts.clickable ? "auto" : "none"
	};${opts.clickable ? "cursor:pointer;" : ""}`;

	const pin = document.createElement("div");
	pin.textContent = isDriver ? "🚗" : "🙋";
	const accent = opts.highlighted || opts.clickable; // 파란 강조 대상
	const size = accent ? 32 : 26;
	const border = accent ? "#0b84ff" : isDriver ? "#fff" : "#b4762b";
	const bg = isDriver ? "#2c7a57" : opts.highlighted ? "#eaf3ff" : "#fff";
	pin.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${
		accent ? 16 : 13
	}px;border:${
		accent ? 3 : 2
	}px solid ${border};box-shadow:0 1px 4px rgba(0,0,0,.3);background:${bg};`;

	const label = document.createElement("div");
	label.style.cssText = `margin-top:2px;display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:${
		opts.highlighted ? "#0a5cb0" : "#0f1724"
	};background:rgba(255,255,255,.9);padding:1px 5px;border-radius:6px;white-space:nowrap;`;
	label.appendChild(document.createTextNode(m.name));

	if (isDriver) {
		const cnt = opts.count ?? 0;
		const over = m.seats != null && cnt > m.seats;
		const badge = document.createElement("span");
		badge.textContent = m.seats != null ? `${cnt}/${m.seats}` : `${cnt}명`;
		badge.style.cssText = `font-weight:800;font-variant-numeric:tabular-nums;color:${
			over ? "#b4762b" : "#146c47"
		};`;
		label.appendChild(badge);
	}

	wrap.append(pin, label);
	return wrap;
}

export default function CarpoolMap({
	roster,
	selected,
	assignedRiderIds,
	assignedCount,
	onAssignToDriver,
	onReady,
}: Props) {
	const [err, setErr] = useState<string | null>(() =>
		hasKakaoKey() ? null : "no-key",
	);
	const [ready, setReady] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const kakaoRef = useRef<any>(null);
	const mapRef = useRef<any>(null);
	const overlaysRef = useRef<any[]>([]);
	const onReadyRef = useRef(onReady);
	useEffect(() => {
		onReadyRef.current = onReady;
	}, [onReady]);

	const big = !!selected && selected.size > 0; // 선택 모드 → 지도 확대

	// 지도 1회 초기화
	useEffect(() => {
		if (!hasKakaoKey()) {
			onReadyRef.current?.(false);
			return;
		}
		let cancelled = false;
		loadKakaoMaps()
			.then((kakao: any) => {
				if (cancelled || !containerRef.current) return;
				kakaoRef.current = kakao;
				mapRef.current = new kakao.maps.Map(containerRef.current, {
					center: new kakao.maps.LatLng(SEOUL.lat, SEOUL.lng),
					level: 7,
				});
				setReady(true);
				onReadyRef.current?.(true);
			})
			.catch(() => {
				if (cancelled) return;
				setErr("load-fail");
				onReadyRef.current?.(false);
			});
		return () => {
			cancelled = true;
			overlaysRef.current.forEach((o) => o.setMap(null));
			overlaysRef.current = [];
			mapRef.current = null;
			kakaoRef.current = null;
		};
	}, []);

	// 명단/선택/배정 변경 시 마커 갱신
	useEffect(() => {
		const kakao = kakaoRef.current;
		const map = mapRef.current;
		if (!kakao || !map || !ready) return;
		let cancelled = false;
		map.relayout(); // 선택으로 컨테이너 높이가 바뀌었을 수 있어 크기 재인식

		// 운전자는 항상 표시. 동승자는 선택 모드면 선택한 사람만, 선택 전이면 미배정만 남긴다.
		const activeSel = !!selected && selected.size > 0;
		const shown = roster.filter((m) => {
			if (m.role === "can_drive") return true;
			if (activeSel) return selected!.has(m.member_id);
			return !assignedRiderIds?.has(m.member_id);
		});
		const regions = shown.map((m) => m.residence ?? "").filter(Boolean);
		geocodeDongs(regions).then((coords) => {
			if (cancelled) return;
			overlaysRef.current.forEach((o) => o.setMap(null));
			overlaysRef.current = [];
			const bounds = new kakao.maps.LatLngBounds();
			const idxByRegion: Record<string, number> = {};
			let placed = 0;
			let last: any = null;
			for (const m of shown) {
				const region = (m.residence ?? "").trim();
				const base = region ? coords.get(region) : null;
				if (!base) continue; // 위치 미상 → 지도 제외(패널에서 처리)
				const i = idxByRegion[region] ?? 0;
				idxByRegion[region] = i + 1;
				// 같은 동 겹침 → 작은 원형 지터로 분산(데이터는 동일 centroid)
				const rad = i === 0 ? 0 : 0.0009;
				const angle = i * 1.1;
				const pos = new kakao.maps.LatLng(
					base.lat + Math.sin(angle) * rad,
					base.lng + Math.cos(angle) * rad,
				);
				const isDriver = m.role === "can_drive";
				const clickable = activeSel && isDriver && !!onAssignToDriver;
				const highlighted =
					activeSel && !isDriver && selected!.has(m.member_id);
				const content = makePin(m, {
					highlighted,
					clickable,
					count: isDriver ? (assignedCount?.[m.member_id] ?? 0) : undefined,
				});
				if (clickable) {
					const did = m.member_id;
					content.addEventListener("click", () => onAssignToDriver?.(did));
				}
				const ov = new kakao.maps.CustomOverlay({
					position: pos,
					content,
					yAnchor: 1,
					clickable,
					zIndex: highlighted ? 10 : clickable ? 6 : 1,
				});
				ov.setMap(map);
				overlaysRef.current.push(ov);
				bounds.extend(pos);
				last = pos;
				placed++;
			}
			if (placed > 1) {
				map.setBounds(bounds, 52, 52, 52, 52);
				if (map.getLevel() < 4) map.setLevel(4); // 같은 동끼리 붙어 과확대되는 것 방지
			} else if (placed === 1) {
				map.setCenter(last);
				map.setLevel(5);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [roster, ready, selected, assignedRiderIds, assignedCount, onAssignToDriver]);

	if (err) {
		return (
			<div
				className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
				style={{
					fontSize: 12.5,
					lineHeight: 1.5,
					padding: "12px 14px",
					borderRadius: 12,
					background: "rgba(100,116,139,0.1)",
				}}
			>
				{err === "no-key"
					? "지도를 쓰려면 카카오 지도 키 설정이 필요해요. 아래 목록만으로도 편성할 수 있어요."
					: "지도를 불러오지 못했어요. 아래 목록으로 편성하세요."}
			</div>
		);
	}

	return (
		<div style={{ position: "relative" }}>
			<div
				ref={containerRef}
				style={{
					width: "100%",
					height: big ? 340 : 180,
					borderRadius: 12,
					overflow: "hidden",
					background: "rgba(100,116,139,0.12)",
				}}
			/>
			{big && (
				<div
					style={{
						position: "absolute",
						top: 8,
						left: 8,
						right: 8,
						display: "flex",
						justifyContent: "center",
						pointerEvents: "none",
					}}
				>
					<span
						style={{
							fontSize: 12,
							fontWeight: 800,
							color: "#fff",
							background: "rgba(11,132,255,0.92)",
							padding: "5px 11px",
							borderRadius: 999,
							boxShadow: "0 2px 8px rgba(0,0,0,.25)",
							whiteSpace: "nowrap",
						}}
					>
						🚗 태울 운전자를 누르세요 · {selected!.size}명
					</span>
				</div>
			)}
		</div>
	);
}

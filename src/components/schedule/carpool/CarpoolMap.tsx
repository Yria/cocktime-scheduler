/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오 지도 SDK는 전역 주입 + 공식 타입 없음 */
import { useEffect, useRef, useState } from "react";
import { geocodeDongs } from "../../../lib/carpool/geocodeResidence";
import { hasKakaoKey, loadKakaoMaps } from "../../../lib/kakaoMap";
import type { CarpoolMember } from "../../../lib/supabase/carpool";

// 운영자 보조 지도 — 운전자/탑승필요자를 거주 동 중심점으로 표시(같은 동은 한 점에 모임).
// 실제 편성은 아래 패널에서. 키 없음/지오코딩 실패는 안내로 대체(graceful degrade).

interface Props {
	roster: CarpoolMember[];
}

const SEOUL = { lat: 37.5666, lng: 126.9784 };

function makePin(m: CarpoolMember): HTMLElement {
	const isDriver = m.role === "can_drive";
	const wrap = document.createElement("div");
	wrap.style.cssText =
		"display:flex;flex-direction:column;align-items:center;pointer-events:none;";
	const pin = document.createElement("div");
	pin.textContent = isDriver ? "🚗" : "🙋";
	pin.style.cssText = `width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid ${
		isDriver ? "#fff" : "#b4762b"
	};box-shadow:0 1px 4px rgba(0,0,0,.3);background:${isDriver ? "#2c7a57" : "#fff"};`;
	const label = document.createElement("div");
	label.textContent = m.name;
	label.style.cssText =
		"margin-top:2px;font-size:10px;font-weight:700;color:#0f1724;background:rgba(255,255,255,.85);padding:0 4px;border-radius:5px;white-space:nowrap;";
	wrap.append(pin, label);
	return wrap;
}

export default function CarpoolMap({ roster }: Props) {
	const [err, setErr] = useState<string | null>(() =>
		hasKakaoKey() ? null : "no-key",
	);
	const [ready, setReady] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const kakaoRef = useRef<any>(null);
	const mapRef = useRef<any>(null);
	const overlaysRef = useRef<any[]>([]);

	// 지도 1회 초기화
	useEffect(() => {
		if (!hasKakaoKey()) return;
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
			})
			.catch(() => {
				if (!cancelled) setErr("load-fail");
			});
		return () => {
			cancelled = true;
			overlaysRef.current.forEach((o) => o.setMap(null));
			overlaysRef.current = [];
			mapRef.current = null;
			kakaoRef.current = null;
		};
	}, []);

	// 명단 변경 시 마커 갱신
	useEffect(() => {
		const kakao = kakaoRef.current;
		const map = mapRef.current;
		if (!kakao || !map || !ready) return;
		let cancelled = false;
		const regions = roster.map((m) => m.residence ?? "").filter(Boolean);
		geocodeDongs(regions).then((coords) => {
			if (cancelled) return;
			overlaysRef.current.forEach((o) => o.setMap(null));
			overlaysRef.current = [];
			const bounds = new kakao.maps.LatLngBounds();
			const idxByRegion: Record<string, number> = {};
			let placed = 0;
			let last: any = null;
			for (const m of roster) {
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
				const ov = new kakao.maps.CustomOverlay({
					position: pos,
					content: makePin(m),
					yAnchor: 1,
				});
				ov.setMap(map);
				overlaysRef.current.push(ov);
				bounds.extend(pos);
				last = pos;
				placed++;
			}
			if (placed > 1) map.setBounds(bounds);
			else if (placed === 1) {
				map.setCenter(last);
				map.setLevel(6);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [roster, ready]);

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
		<div
			ref={containerRef}
			style={{
				width: "100%",
				height: 180,
				borderRadius: 12,
				overflow: "hidden",
				background: "rgba(100,116,139,0.12)",
			}}
		/>
	);
}

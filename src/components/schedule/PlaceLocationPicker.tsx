/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오 지도 SDK는 전역 주입 + 공식 타입 없음 */
import { useCallback, useEffect, useRef, useState } from "react";
import { hasKakaoKey, loadKakaoMaps } from "../../lib/kakaoMap";
import type { CreatePlaceInput } from "../../lib/supabase/schedule";
import type { PlaceRow } from "../../lib/supabase/types";
import {
	inputCls,
	inputStyle,
	labelCls,
	labelStyle,
} from "../common/fieldStyles";
import ModalSheet from "../common/ModalSheet";
import { Switch } from "../common/Switch";

interface Props {
	onAddPlace: (input: CreatePlaceInput) => Promise<PlaceRow | null>;
	onCreated: (place: PlaceRow) => void;
	onClose: () => void;
}

// 카카오 services.keywordSearch 결과(필요한 필드만)
interface KakaoPlace {
	place_name: string;
	address_name: string;
	road_address_name: string;
	x: string; // lng
	y: string; // lat
}

interface Selected {
	name: string;
	address: string;
	lat: number;
	lng: number;
}

const SEOUL = { lat: 37.5666, lng: 126.9784 }; // 초기 지도 중심

export default function PlaceLocationPicker({
	onAddPlace,
	onCreated,
	onClose,
}: Props) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<KakaoPlace[]>([]);
	const [selected, setSelected] = useState<Selected | null>(null);
	// 키 없으면 초기값으로 안내(effect 내 동기 setState 회피). 로드 실패는 .catch(비동기)에서 설정.
	const [sdkError, setSdkError] = useState<string | null>(() =>
		hasKakaoKey()
			? null
			: "지도/검색을 쓰려면 VITE_KAKAO_MAP_KEY 설정이 필요해요(카카오 콘솔에 도메인 등록 포함).",
	);
	const [hint, setHint] = useState<string | null>(null);
	const [chargesCourtFee, setChargesCourtFee] = useState(false); // 대관장소 여부(대관비 부과 대상)
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [mapReady, setMapReady] = useState(false);

	const containerRef = useRef<HTMLDivElement | null>(null);
	const kakaoRef = useRef<any>(null);
	const mapRef = useRef<any>(null);
	const markerRef = useRef<any>(null);
	const placesRef = useRef<any>(null);

	// 선택 좌표를 지도에 표시(미리보기 전용 — 드래그/클릭 없음)
	const showOnMap = useCallback((lat: number, lng: number) => {
		const kakao = kakaoRef.current;
		const map = mapRef.current;
		if (!kakao || !map) return;
		const pos = new kakao.maps.LatLng(lat, lng);
		map.setCenter(pos);
		map.setLevel(3);
		if (!markerRef.current) {
			markerRef.current = new kakao.maps.Marker({ position: pos });
		} else {
			markerRef.current.setPosition(pos);
		}
		markerRef.current.setMap(map);
	}, []);

	// 카카오 지도 초기화(마운트 1회) — 미리보기 + 키워드 검색용
	useEffect(() => {
		if (!hasKakaoKey()) return; // sdkError 는 초기값에서 이미 설정됨
		let cancelled = false;
		loadKakaoMaps()
			.then((kakao: any) => {
				if (cancelled || !containerRef.current) return;
				kakaoRef.current = kakao;
				const map = new kakao.maps.Map(containerRef.current, {
					center: new kakao.maps.LatLng(SEOUL.lat, SEOUL.lng),
					level: 8,
				});
				mapRef.current = map;
				placesRef.current = new kakao.maps.services.Places();
				setMapReady(true);
			})
			.catch((err: Error) => {
				if (!cancelled) setSdkError(err.message);
			});
		return () => {
			cancelled = true;
			markerRef.current?.setMap(null);
			markerRef.current = null;
			mapRef.current = null;
			placesRef.current = null;
			kakaoRef.current = null;
		};
	}, []);

	const handleSearch = () => {
		const q = query.trim();
		if (!q) return;
		const places = placesRef.current;
		const kakao = kakaoRef.current;
		if (!places || !kakao) return;
		setHint(null);
		places.keywordSearch(q, (data: KakaoPlace[], status: any) => {
			const S = kakao.maps.services.Status;
			if (status === S.OK) {
				setResults(data.slice(0, 7));
			} else if (status === S.ZERO_RESULT) {
				setResults([]);
				setHint("검색 결과가 없어요. 다른 이름으로 시도하세요.");
			} else {
				setResults([]);
				setHint("검색에 실패했어요. 잠시 후 다시 시도해 주세요.");
			}
		});
	};

	// 검색 결과 선택 → 이름·주소·좌표 확정 + 지도 표시
	const selectResult = (r: KakaoPlace) => {
		const lat = Number(r.y);
		const lng = Number(r.x);
		setSelected({
			name: r.place_name,
			address: r.road_address_name || r.address_name,
			lat,
			lng,
		});
		setResults([]);
		setError(null);
		showOnMap(lat, lng);
	};

	const handleSave = async () => {
		if (busy) return;
		if (!selected) {
			setError("장소를 검색해 선택하세요.");
			return;
		}
		setError(null);
		setBusy(true);
		try {
			const place = await onAddPlace({
				name: selected.name,
				address: selected.address || null,
				lat: selected.lat,
				lng: selected.lng,
				mapUrl: null,
				chargesCourtFee,
			});
			if (place) {
				setBusy(false);
				onCreated(place);
			} else {
				setError("장소 저장에 실패했어요. 다시 시도해 주세요.");
				setBusy(false);
			}
		} catch {
			setError("장소 저장에 실패했어요. 다시 시도해 주세요.");
			setBusy(false);
		}
	};

	const searchDisabled = !!sdkError || !mapReady;

	return (
		<ModalSheet
			position="bottom"
			onClose={onClose}
			closeOnEscape
			zIndex={60}
			title="새 장소"
		>
			<div className="px-5 pb-5">
				<div className="flex flex-col gap-4">
					{/* 1. 장소 검색 */}
					<div>
						<label className={labelCls} style={labelStyle}>
							장소 검색
						</label>
						<div className="flex gap-2">
							<input
								type="text"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										handleSearch();
									}
								}}
								placeholder="장소명으로 검색 (예: 행복체육관)"
								disabled={searchDisabled}
								className={inputCls}
								style={{ ...inputStyle, flex: 1 }}
							/>
							<button
								type="button"
								onClick={handleSearch}
								disabled={searchDisabled}
								className="btn-tint-blue rounded-[10px] px-4 py-0 text-sm bg-[rgba(11,132,255,0.12)] whitespace-nowrap disabled:opacity-50"
							>
								검색
							</button>
						</div>

						{!sdkError && !mapReady && (
							<p
								className="text-faint"
								style={{ fontSize: 12, marginTop: 6 }}
							>
								지도 불러오는 중…
							</p>
						)}

						{/* 검색 결과(최대 7) */}
						{results.length > 0 && (
							<ul
								className="mt-2 bg-white dark:bg-[rgba(30,30,35,0.8)] border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]"
								style={{
									borderRadius: 10,
									overflow: "hidden",
									listStyle: "none",
									margin: "8px 0 0",
									padding: 0,
								}}
							>
								{results.map((r) => (
									<li key={`${r.place_name}-${r.x}-${r.y}`}>
										<button
											type="button"
											onClick={() => selectResult(r)}
											className="w-full text-left border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.06)]"
											style={{
												background: "none",
												border: "none",
												borderBottom: "1px solid rgba(0,0,0,0.06)",
												padding: "10px 12px",
												cursor: "pointer",
												display: "block",
											}}
										>
											<span
												className="text-strong block"
												style={{ fontSize: 14, fontWeight: 700 }}
											>
												{r.place_name}
											</span>
											<span
												className="text-muted block"
												style={{ fontSize: 12.5, marginTop: 2 }}
											>
												{r.road_address_name || r.address_name}
											</span>
										</button>
									</li>
								))}
							</ul>
						)}

						{/* 선택한 장소 표시 */}
						{selected && (
							<p
								style={{
									fontSize: 13,
									fontWeight: 700,
									color: "#0b84ff",
									marginTop: 8,
								}}
							>
								✓ 선택: {selected.name}
							</p>
						)}

						{hint && (
							<p
								className="text-muted"
								style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 6 }}
							>
								{hint}
							</p>
						)}
					</div>

					{/* 2. 주소(검색으로 자동 입력, readonly) */}
					<div>
						<label className={labelCls} style={labelStyle}>
							주소
						</label>
						<input
							type="text"
							value={selected?.address ?? ""}
							readOnly
							placeholder="장소 검색 후 자동 입력"
							className={inputCls}
							style={{ ...inputStyle, background: "rgba(100,116,139,0.08)" }}
						/>
					</div>

					{/* 3. 지도 미리보기 */}
					<div>
						<label className={labelCls} style={labelStyle}>
							지도
						</label>
						{sdkError ? (
							<p
								className="text-muted"
								style={{
									fontSize: 13,
									lineHeight: 1.5,
									padding: "12px 14px",
									borderRadius: 12,
									background: "rgba(100,116,139,0.1)",
								}}
							>
								{sdkError}
							</p>
						) : (
							<div
								ref={containerRef}
								style={{
									width: "100%",
									height: 220,
									borderRadius: 12,
									overflow: "hidden",
									background: "rgba(100,116,139,0.12)",
								}}
							/>
						)}
					</div>

					{/* 4. 대관장소 여부 — places.charges_court_fee. 실제 총액은 일정(반복 규칙·회차)에서 입력 */}
					<div>
						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-0.5">
								<span className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>
									대관장소
								</span>
								<span className="text-faint" style={{ fontSize: 11.5 }}>
									켜면 이 장소 세션 참석자에게 대관비를 부과해요
								</span>
							</div>
							<Switch
								checked={chargesCourtFee}
								onChange={setChargesCourtFee}
								ariaLabel="대관장소"
							/>
						</div>
						<p
							className="text-faint"
							style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}
						>
							실제 대관 총액은 일정(반복 규칙·회차)에서 입력해요. 총액이 있으면 참석 인원으로
							엔빵(나눗셈), 없으면 정액(인당)이 부과돼요.
						</p>
					</div>

					{error && (
						<p style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}>
							{error}
						</p>
					)}

					{/* 저장 */}
					<button
						type="button"
						onClick={handleSave}
						disabled={busy}
						className="btn-solid-blue"
					>
						{busy ? "저장 중…" : "장소 저장"}
					</button>
				</div>
			</div>
		</ModalSheet>
	);
}

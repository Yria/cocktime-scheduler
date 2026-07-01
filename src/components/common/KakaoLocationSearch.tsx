/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오 지도 SDK는 전역 주입 + 공식 타입 없음 */
import { useCallback, useEffect, useRef, useState } from "react";
import { dongFromAddress } from "../../lib/carpool/dong";
import { hasKakaoKey, loadKakaoMaps } from "../../lib/kakaoMap";

// 카카오 지도 임베드 + 장소 키워드 자동완성(타이핑에 따라 디바운스 검색) + 핀 미리보기 공용 컴포넌트.
// 결과 선택 시 onPick 으로 {이름, 주소, 좌표, 행정구역(동)}을 넘긴다.
// value/onChangeText 를 주면 이 검색창이 곧 그 텍스트 필드를 겸한다(자동완성 + 직접입력 → 별도 입력칸 불필요).
// SDK 미로딩/키 없음이어도 입력 자체는 항상 가능(직접입력 폴백); 이때 자동완성만 비활성.

export interface PickedLocation {
	placeName: string;
	address: string;
	lat: number;
	lng: number;
	/** 행정구역 "구 동" (coord2RegionCode 기반, 실패 시 주소에서 추출) */
	region: string;
}

interface KakaoPlace {
	place_name: string;
	address_name: string;
	road_address_name: string;
	x: string; // lng
	y: string; // lat
}

interface Props {
	onPick: (loc: PickedLocation) => void;
	placeholder?: string;
	heightPx?: number;
	/** 제어형 입력값 — 지정 시 검색창이 이 텍스트 필드를 겸한다(자동완성 + 직접입력). */
	value?: string;
	/** 입력 텍스트 변경(직접 타이핑) 콜백. */
	onChangeText?: (v: string) => void;
}

const SEOUL = { lat: 37.5666, lng: 126.9784 };

const inputCls =
	"w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-[#0f1724] dark:text-white border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]";
const inputStyle: React.CSSProperties = {
	padding: "11px 13px",
	borderRadius: 10,
	fontSize: 15,
	outline: "none",
};

export default function KakaoLocationSearch({
	onPick,
	placeholder = "장소·동 이름으로 검색",
	heightPx = 200,
	value,
	onChangeText,
}: Props) {
	const [internalQuery, setInternalQuery] = useState("");
	// 제어형(value 지정)이면 입력값은 부모가 소유, 아니면 내부 상태.
	const query = value !== undefined ? value : internalQuery;
	const [results, setResults] = useState<KakaoPlace[]>([]);
	const [sdkError, setSdkError] = useState<string | null>(() =>
		hasKakaoKey()
			? null
			: "지도/검색을 쓰려면 VITE_KAKAO_MAP_KEY 설정이 필요해요(카카오 콘솔 도메인 등록 포함).",
	);
	const [hint, setHint] = useState<string | null>(null);
	const [mapReady, setMapReady] = useState(false);

	const containerRef = useRef<HTMLDivElement | null>(null);
	const kakaoRef = useRef<any>(null);
	const mapRef = useRef<any>(null);
	const markerRef = useRef<any>(null);
	const placesRef = useRef<any>(null);
	const geocoderRef = useRef<any>(null);
	const debounceRef = useRef<number | null>(null);
	// 검색 요청 순번 — 겹친 요청의 늦게 도착한 stale 응답을 폐기(최신 응답만 반영).
	const searchSeqRef = useRef(0);

	// 입력 텍스트 갱신 — 제어형이면 부모로, 아니면 내부 상태.
	const setText = useCallback(
		(v: string) => {
			if (onChangeText) onChangeText(v);
			else setInternalQuery(v);
		},
		[onChangeText],
	);

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

	useEffect(() => {
		if (!hasKakaoKey()) return; // sdkError 초기값에 이미 설정
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
				geocoderRef.current = new kakao.maps.services.Geocoder();
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
			geocoderRef.current = null;
			kakaoRef.current = null;
		};
	}, []);

	// 디바운스 타이머 정리(언마운트).
	useEffect(
		() => () => {
			if (debounceRef.current) window.clearTimeout(debounceRef.current);
		},
		[],
	);

	const runSearch = useCallback((q: string) => {
		const places = placesRef.current;
		const kakao = kakaoRef.current;
		if (!q || !places || !kakao) return;
		const seq = ++searchSeqRef.current;
		setHint(null);
		places.keywordSearch(q, (data: KakaoPlace[], status: any) => {
			if (seq !== searchSeqRef.current) return; // 늦게 온 stale 응답 폐기
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
	}, []);

	// 타이핑 → 입력 반영 + 디바운스 자동완성(300ms). SDK 미준비면 검색만 생략(입력은 유지).
	const onType = (v: string) => {
		setText(v);
		if (debounceRef.current) window.clearTimeout(debounceRef.current);
		const q = v.trim();
		if (!q) {
			setResults([]);
			setHint(null);
			return;
		}
		debounceRef.current = window.setTimeout(() => runSearch(q), 300);
	};

	const selectResult = (r: KakaoPlace) => {
		const lat = Number(r.y);
		const lng = Number(r.x);
		const address = r.road_address_name || r.address_name;
		showOnMap(lat, lng);
		setResults([]);
		if (debounceRef.current) window.clearTimeout(debounceRef.current);
		searchSeqRef.current++; // 선택 후 뒤늦게 오는 검색 응답이 목록을 되살리지 않게 무효화
		const kakao = kakaoRef.current;
		const geocoder = geocoderRef.current;
		const emit = (region: string) => {
			// 제어형은 onPick 이 부모 value 를 바꿔 입력창에 동이 표시됨. 비제어형은 직접 표시.
			if (value === undefined) setInternalQuery(region);
			onPick({ placeName: r.place_name, address, lat, lng, region });
		};
		if (kakao && geocoder) {
			// 좌표 → 행정구역(동) 변환. 법정동(B) 우선.
			geocoder.coord2RegionCode(lng, lat, (res: any[], status: any) => {
				if (status === kakao.maps.services.Status.OK && res?.length) {
					const e = res.find((x) => x.region_type === "B") || res[0];
					const region =
						[e.region_2depth_name, e.region_3depth_name]
							.filter(Boolean)
							.join(" ") || dongFromAddress(address);
					emit(region);
				} else {
					emit(dongFromAddress(address));
				}
			});
		} else {
			emit(dongFromAddress(address));
		}
	};

	return (
		<div>
			<input
				type="text"
				value={query}
				onChange={(e) => onType(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						if (debounceRef.current) window.clearTimeout(debounceRef.current);
						runSearch(query.trim());
					}
				}}
				placeholder={placeholder}
				className={inputCls}
				style={{ ...inputStyle, width: "100%" }}
			/>

			{!sdkError && !mapReady && (
				<p
					className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.45)]"
					style={{ fontSize: 12, marginTop: 6 }}
				>
					지도 불러오는 중…
				</p>
			)}

			{/* 자동완성 결과 */}
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
								style={{
									width: "100%",
									textAlign: "left",
									background: "none",
									border: "none",
									borderBottom: "1px solid rgba(0,0,0,0.06)",
									padding: "10px 12px",
									cursor: "pointer",
									display: "block",
								}}
							>
								<span
									className="text-[#0f1724] dark:text-white block"
									style={{ fontSize: 14, fontWeight: 700 }}
								>
									{r.place_name}
								</span>
								<span
									className="text-[#64748b] dark:text-[rgba(235,235,245,0.55)] block"
									style={{ fontSize: 12.5, marginTop: 2 }}
								>
									{r.road_address_name || r.address_name}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}

			{hint && (
				<p
					className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
					style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 6 }}
				>
					{hint}
				</p>
			)}

			{/* 지도 미리보기 / 키 없음 안내 */}
			{sdkError ? (
				<p
					className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
					style={{
						fontSize: 13,
						lineHeight: 1.5,
						padding: "12px 14px",
						borderRadius: 12,
						background: "rgba(100,116,139,0.1)",
						marginTop: 8,
					}}
				>
					{sdkError}
				</p>
			) : (
				<div
					ref={containerRef}
					style={{
						width: "100%",
						height: heightPx,
						borderRadius: 12,
						overflow: "hidden",
						background: "rgba(100,116,139,0.12)",
						marginTop: 8,
					}}
				/>
			)}
		</div>
	);
}

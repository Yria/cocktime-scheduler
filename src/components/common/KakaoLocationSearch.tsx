/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오 지도 SDK는 전역 주입 + 공식 타입 없음 */
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { dongFromAddress } from "../../lib/carpool/dong";
import { hasKakaoKey, loadKakaoMaps } from "../../lib/kakaoMap";
import EmptyState from "../shared/EmptyState";
import { inputCls, inputStyle } from "./fieldStyles";

// 카카오 지도 임베드 + 장소 키워드 자동완성(타이핑에 따라 디바운스 검색) + 핀 미리보기 공용 컴포넌트.
// 결과 선택 시 onPick 으로 {이름, 주소, 좌표, 행정구역(동)}을 넘긴다.
// value/onChangeText 를 주면 이 검색창이 곧 그 텍스트 필드를 겸한다(자동완성 + 직접입력 → 별도 입력칸 불필요).
// SDK 미로딩/키 없음이어도 입력 자체는 항상 가능(직접입력 폴백); 이때 자동완성만 비활성.
//
// 자동완성 목록은 **popover(top layer)** 로 뜬다 — 문서 흐름에 넣으면 아래 요소(지도 미리보기,
// 저장 버튼 등)를 밀어내 화면이 출렁인다. 이 컴포넌트는 ModalSheet 안에서 쓰이는데 시트는
// overflow-y:auto + backdrop-filter 라, absolute 는 시트 경계에서 잘리고 position:fixed 조차
// 시트에 갇힌다(filter 가 fixed 의 containing block 을 만든다). top layer 는 조상의 overflow·
// filter·z-index 를 모두 무시하므로 이 두 함정을 한 번에 피한다.
// 위치는 입력칸 rect 로 직접 계산한다(CSS anchor positioning 은 아직 기대지 않는다).

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
	const inputRef = useRef<HTMLInputElement | null>(null);
	const popRef = useRef<HTMLUListElement | null>(null);
	// 자동완성 popover 좌표. 위로 열 때는 bottom 기준으로 붙여(내용이 짧아도) 입력칸에 딱 맞춘다.
	const [popPos, setPopPos] = useState<{
		left: number;
		width: number;
		top?: number;
		bottom?: number;
		maxHeight: number;
	} | null>(null);
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

	/** 입력칸 rect → popover 좌표. 아래 공간이 좁으면 위로 뒤집는다. */
	const placePopover = useCallback(() => {
		const el = inputRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		// 시각 뷰포트 기준(iOS 키보드가 올라오면 실제로 보이는 영역이 줄어든다).
		const vv = window.visualViewport;
		const viewTop = vv?.offsetTop ?? 0;
		const viewH = vv?.height ?? window.innerHeight;
		const GAP = 6;
		const below = viewTop + viewH - r.bottom - GAP - 8;
		const above = r.top - viewTop - GAP - 8;
		// 아래가 좁고 위가 더 넓을 때만 위로. (기본은 아래 — 드롭다운의 자연스러운 방향)
		const openUp = below < 160 && above > below;
		const maxHeight = Math.max(120, Math.min(320, openUp ? above : below));
		setPopPos({
			left: r.left,
			width: r.width,
			maxHeight,
			...(openUp
				? { bottom: (vv?.height ?? window.innerHeight) - r.top + GAP + viewTop }
				: { top: r.bottom + GAP }),
		});
	}, []);

	// popover 열림 조건 — 결과 목록 또는 안내문(결과 없음/실패). 둘 다 흐름에서 빼야 화면이 안 밀린다.
	const popOpen = results.length > 0 || hint != null;

	// 열릴 때 좌표를 잡고, 스크롤·리사이즈 중에도 입력칸을 따라다니게 한다.
	// scroll 은 capture 로 받아야 시트 등 중간 스크롤 컨테이너의 스크롤까지 잡힌다.
	// layout effect — 페인트 전에 좌표를 확정해 첫 프레임 점프를 막는다.
	useLayoutEffect(() => {
		if (!popOpen) return;
		// 열리는 커밋에서 바로 갱신 — layout effect 의 setState 는 페인트 전에 재렌더되므로
		// 이전에 열렸던 좌표가 한 프레임 스쳐 보이지 않는다(닫을 때 좌표를 비울 필요 없음).
		placePopover();
		const onMove = () => placePopover();
		window.addEventListener("scroll", onMove, true);
		window.addEventListener("resize", onMove);
		window.visualViewport?.addEventListener("resize", onMove);
		window.visualViewport?.addEventListener("scroll", onMove);
		return () => {
			window.removeEventListener("scroll", onMove, true);
			window.removeEventListener("resize", onMove);
			window.visualViewport?.removeEventListener("resize", onMove);
			window.visualViewport?.removeEventListener("scroll", onMove);
		};
	}, [popOpen, placePopover]);

	// top layer 로 올리기/내리기. 이미 열린/닫힌 상태에서 호출하면 예외가 나므로 상태를 확인한다.
	// 미지원 브라우저에서는 showPopover 가 없다 — 이때는 위 style 의 display + position:fixed 로만 뜬다.
	useLayoutEffect(() => {
		const el = popRef.current;
		if (!el || typeof el.showPopover !== "function") return;
		const shouldOpen = popOpen && popPos != null;
		// display:none 인 동안 showPopover 를 부르면 무시되므로 좌표가 잡힌 뒤에 올린다.
		const isOpen = el.matches(":popover-open");
		if (shouldOpen && !isOpen) el.showPopover();
		else if (!shouldOpen && isOpen) el.hidePopover();
	}, [popOpen, popPos]);

	// 바깥을 누르면 닫는다(manual popover 라 light-dismiss 가 없다). 입력칸 자체는 예외 —
	// 눌러서 이어 타이핑하는 흐름을 끊지 않는다.
	useEffect(() => {
		if (!popOpen) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target as Node | null;
			if (!t) return;
			if (popRef.current?.contains(t) || inputRef.current?.contains(t)) return;
			setResults([]);
			setHint(null);
		};
		document.addEventListener("pointerdown", onDown, true);
		return () => document.removeEventListener("pointerdown", onDown, true);
	}, [popOpen]);

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
				ref={inputRef}
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
				<EmptyState loading spinnerSize={16} style={{ padding: "6px 0 0" }} />
			)}

			{/* 자동완성 결과 — popover(top layer). 흐름에서 빠져 아래 요소를 밀지 않는다.
			    UA 기본 스타일(inset:0 / margin:auto / border:solid / padding:.25em)을 전부 덮어쓴다. */}
			<ul
				ref={popRef}
				popover="manual"
				className="bg-white dark:bg-[rgba(30,30,35,0.98)] border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.14)]"
				style={{
					// display 를 직접 토글한다. popover 미지원 브라우저(iOS 16 이하)에는
					// `[popover]:not(:popover-open){display:none}` UA 규칙이 없어 목록이 항상 보이게 된다.
					// 좌표가 잡히기 전(popPos=null)에도 숨겨 첫 프레임에 (0,0) 에서 깜빡이지 않게 한다.
					display: popOpen && popPos ? "block" : "none",
					inset: "auto",
					position: "fixed",
					left: popPos?.left ?? 0,
					width: popPos?.width ?? "auto",
					...(popPos?.bottom != null
						? { bottom: popPos.bottom }
						: { top: popPos?.top ?? 0 }),
					maxHeight: popPos?.maxHeight ?? 320,
					margin: 0,
					padding: 0,
					borderRadius: 10,
					overflowY: "auto",
					overscrollBehavior: "contain",
					listStyle: "none",
					boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
				}}
			>
				{hint != null && results.length === 0 && (
					<li
						className="text-muted"
						style={{ fontSize: 12.5, lineHeight: 1.5, padding: "10px 12px" }}
					>
						{hint}
					</li>
				)}
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

			{/* 지도 미리보기 / 키 없음 안내 */}
			{sdkError ? (
				<p
					className="text-muted"
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

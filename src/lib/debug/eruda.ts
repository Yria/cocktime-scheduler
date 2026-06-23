// ⚠️ [임시 디버그] iOS PWA 하단 safe-area 진단용.
// eruda(인페이지 모바일 콘솔)를 CDN에서 로드하고, 앱 시작 시 safe-area 측정값을
// 자동으로 콘솔에 출력한다. Mac/케이블 없이 아이폰에서 직접 콘솔을 볼 수 있다.
//   - 화면 이동 후 다시 찍으려면 eruda 콘솔에서 `__saDump()` 호출.
//   - 끄려면 eruda 콘솔에서 `localStorage.setItem('cocktime_debug','off')` 후 재실행.
// 진단이 끝나면: main.tsx 의 initErudaDebug() 호출 + 이 파일을 삭제할 것.

interface ErudaGlobal {
	init: () => void;
}

export function initErudaDebug(): void {
	if (localStorage.getItem("cocktime_debug") === "off") return;
	// 화면 어디서든 재실행 가능하게 전역 노출
	(window as unknown as { __saDump: () => void }).__saDump = dump;

	const s = document.createElement("script");
	s.src = "https://cdn.jsdelivr.net/npm/eruda";
	s.onload = () => {
		const eruda = (window as unknown as { eruda?: ErudaGlobal }).eruda;
		if (!eruda) return;
		eruda.init();
		dump();
		// 콜드스타트 직후 값이 안정화된 뒤 재측정
		setTimeout(dump, 1500);
	};
	s.onerror = () => console.warn("[debug] eruda 로드 실패 — 네트워크/CDN 확인");
	document.body.appendChild(s);
}

function measure(h: string): number {
	const e = document.createElement("div");
	e.style.cssText = `position:fixed;top:0;left:0;width:1px;height:${h};visibility:hidden;pointer-events:none`;
	document.body.appendChild(e);
	const v = Math.round(e.getBoundingClientRect().height);
	e.remove();
	return v;
}

function describe(el: Element): string {
	const cls =
		typeof el.className === "string" && el.className
			? "." + el.className.trim().replace(/\s+/g, ".").slice(0, 48)
			: "";
	const id = (el as HTMLElement).id ? "#" + (el as HTMLElement).id : "";
	return el.tagName.toLowerCase() + id + cls;
}

function props(el: Element) {
	const c = getComputedStyle(el);
	const r = el.getBoundingClientRect();
	return {
		node: describe(el),
		pos: c.position,
		h: c.height,
		minH: c.minHeight,
		ovY: c.overflowY,
		tf: c.transform === "none" ? "none" : "yes",
		offH: (el as HTMLElement).offsetHeight,
		top: Math.round(r.top),
		bot: Math.round(r.bottom),
	};
}

/** safe-area 진단 덤프 — VIEWPORT 수치 + 부모효과 스캔 + 셸 조상 체인. */
function dump(): void {
	const fp = document.createElement("div");
	fp.style.cssText = "position:fixed;inset:0;visibility:hidden;pointer-events:none";
	document.body.appendChild(fp);
	const fr = fp.getBoundingClientRect();
	fp.remove();
	const vv = window.visualViewport;
	console.log(
		"=== SAFE-AREA VIEWPORT ===",
		JSON.stringify({
			screenH: screen.height,
			availH: screen.availHeight,
			outerH: window.outerHeight,
			innerH: innerHeight,
			clientH: document.documentElement.clientHeight,
			vh: measure("100vh"),
			lvh: measure("100lvh"),
			svh: measure("100svh"),
			dvh: measure("100dvh"),
			insetTop: measure("env(safe-area-inset-top)"),
			insetBottom: measure("env(safe-area-inset-bottom)"),
			visualVPH: Math.round(vv?.height ?? 0),
			visualTop: Math.round(vv?.offsetTop ?? 0),
			fixedTop: Math.round(fr.top),
			fixedBot: Math.round(fr.bottom),
			standalone: matchMedia("(display-mode: standalone)").matches,
			ua: navigator.userAgent,
		}),
	);
	paintProbe();

	// 부모효과 스캔: containing-block 생성/overflow 요소
	const flags: string[] = [];
	for (const el of Array.from(document.querySelectorAll("*"))) {
		const c = getComputedStyle(el);
		const i: string[] = [];
		if (c.transform !== "none") i.push("transform");
		if (c.filter !== "none") i.push("filter");
		if (c.perspective !== "none") i.push("perspective");
		if (c.willChange !== "auto") i.push("willChange");
		if (!["normal", "none", ""].includes(c.contain)) i.push("contain");
		if (
			["hidden", "auto", "scroll"].includes(c.overflowY) &&
			el !== document.documentElement &&
			el !== document.body
		)
			i.push("ovY=" + c.overflowY);
		if (i.length) flags.push(describe(el) + " -> " + i.join(","));
	}
	console.log(`=== CB/OVERFLOW FLAGS (${flags.length}) ===`);
	flags.forEach((f) => console.log("  " + f));

	// 셸 조상 체인 (부모까지) — 956 vs 894 가 어디서 깎이는지
	const shell =
		document.querySelector(".app-shell-h") ??
		document.querySelector(".app-shell-minh");
	if (shell) {
		console.log("=== ANCESTOR CHAIN (shell → html) ===");
		const rows: ReturnType<typeof props>[] = [];
		let cur: Element | null = shell;
		while (cur) {
			rows.unshift(props(cur));
			cur = cur.parentElement;
		}
		rows.forEach((r) => console.log("  " + JSON.stringify(r)));
		console.log("shell.offsetHeight =", (shell as HTMLElement).offsetHeight);
	} else {
		console.log("(.app-shell-h / .app-shell-minh 가 이 화면엔 없음)");
	}
}

/**
 * 페인트 가능 영역 시각 테스트:
 *  - 빨강 바: position:fixed; bottom:0 (뷰포트 바닥 = lvh 기준)
 *  - 라임 바: top:(screen.height-4) (물리 화면 바닥 위치) — 보이면 웹뷰가 그 아래까지 그린다는 뜻
 *  - 파랑 띠: env(safe-area-inset-bottom) 구역
 * 라임 바가 빨강 아래로 보이면 → JS로 screen.height 강제 가능. 안 보이면 → 869 이 하드 한계.
 */
function paintProbe(): void {
	document.getElementById("__sa_probe")?.remove();
	const wrap = document.createElement("div");
	wrap.id = "__sa_probe";
	const z = "z-index:2147483647;pointer-events:none";
	const red = document.createElement("div");
	red.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:4px;background:red;${z}`;
	const lime = document.createElement("div");
	lime.style.cssText = `position:fixed;left:0;right:0;top:${screen.height - 4}px;height:4px;background:#0f0;${z}`;
	const blue = document.createElement("div");
	blue.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:env(safe-area-inset-bottom);background:rgba(0,90,255,0.4);z-index:2147483646;pointer-events:none`;
	wrap.append(red, lime, blue);
	document.body.appendChild(wrap);
}

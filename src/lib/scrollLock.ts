/**
 * 모달 열림 동안 배경 스크롤을 잠근다.
 *
 * iOS 26 Safari 대응을 위해 백드롭을 position:absolute(문서 전체 높이)로 깔면서,
 * 배경 스크롤락도 body{position:fixed} 방식에서 이 방식으로 교체했다. 문서를 fixed 로 들어내면
 * absolute 백드롭의 기준점이 스크롤량만큼 틀어지기 때문이다.
 *
 * 구현은 adobe/react-spectrum 의 usePreventScroll(preventScrollMobileSafari) 을 이식한 것.
 * position:fixed 대신 문서를 그 자리에 둔 채:
 *  - html 에 overflow:hidden
 *  - `* { overscroll-behavior: contain }` 스타일 주입(iOS 26 은 touchstart 전에 걸려 있어야 함)
 *  - touchmove(capture)에서 스크롤 가능한 요소 밖이면 preventDefault → window 스크롤 차단
 *  - 인풋 포커스 시 페이지가 통째로 스크롤되는 Safari 동작을 억제하고 직접 scrollIntoView
 * 로 처리해, 시트 내부 스크롤·슬라이더·텍스트 선택·핀치줌은 살리면서 배경만 막는다.
 */

let lockCount = 0;
let restore: (() => void) | null = null;

/** 잠금(참조 카운트). 반환된 함수를 호출하면 해제. 마지막 해제 시 원복. */
export function lockScroll(): () => void {
	lockCount++;
	if (lockCount === 1) {
		restore = isIOS() ? preventScrollMobileSafari() : preventScrollStandard();
	}
	return () => {
		lockCount--;
		if (lockCount === 0 && restore) {
			restore();
			restore = null;
		}
	};
}

function isIOS(): boolean {
	if (typeof navigator === "undefined") return false;
	const ua = navigator.userAgent;
	return (
		/iP(hone|od|ad)/.test(ua) ||
		// iPadOS 13+ 는 Mac 으로 위장 → touch 지원으로 판별
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
	);
}

function isScrollable(node: Element | null): boolean {
	if (!node) return false;
	const style = window.getComputedStyle(node);
	return /(auto|scroll)/.test(
		style.overflow + style.overflowX + style.overflowY,
	);
}

function getScrollParent(node: Element): Element {
	let n: Element | null = node;
	if (isScrollable(n)) n = n.parentElement;
	while (n && !isScrollable(n)) n = n.parentElement;
	return n || document.scrollingElement || document.documentElement;
}

// 소프트 키보드를 띄우는 입력 요소인지 — 포커스 시 페이지 스크롤 억제 대상.
const nonTextInputTypes = new Set([
	"checkbox",
	"radio",
	"range",
	"color",
	"file",
	"image",
	"button",
	"submit",
	"reset",
]);
function willOpenKeyboard(target: Element | null): boolean {
	return (
		(target instanceof HTMLInputElement && !nonTextInputTypes.has(target.type)) ||
		target instanceof HTMLTextAreaElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	);
}

function setStyle(
	element: HTMLElement,
	property: string,
	value: string,
): () => void {
	const style = element.style as unknown as Record<string, string>;
	const cur = style[property];
	style[property] = value;
	return () => {
		style[property] = cur;
	};
}

function addEvent<K extends keyof DocumentEventMap>(
	target: Document,
	event: K,
	handler: (ev: DocumentEventMap[K]) => void,
	options?: boolean | AddEventListenerOptions,
): () => void {
	target.addEventListener(event, handler as EventListener, options);
	return () => target.removeEventListener(event, handler as EventListener, options);
}

// 데스크톱/안드로이드: 루트에 overflow:hidden 만으로 충분.
function preventScrollStandard(): () => void {
	const scrollbarWidth =
		window.innerWidth - document.documentElement.clientWidth;
	const restoreGutter =
		scrollbarWidth > 0
			? "scrollbarGutter" in document.documentElement.style
				? setStyle(document.documentElement, "scrollbarGutter", "stable")
				: setStyle(
						document.documentElement,
						"paddingRight",
						`${scrollbarWidth}px`,
					)
			: () => {};
	const restoreOverflow = setStyle(
		document.documentElement,
		"overflow",
		"hidden",
	);
	return () => {
		restoreGutter();
		restoreOverflow();
	};
}

const vv = typeof document !== "undefined" ? window.visualViewport : null;

function preventScrollMobileSafari(): () => void {
	const restoreOverflow = setStyle(
		document.documentElement,
		"overflow",
		"hidden",
	);

	let scrollable: Element | null = null;
	let allowTouchMove = false;

	const onTouchStart = (e: TouchEvent) => {
		const target = e.target as Element;
		scrollable = isScrollable(target) ? target : getScrollParent(target);
		allowTouchMove = false;

		const selection = target.ownerDocument.defaultView?.getSelection();
		if (selection && !selection.isCollapsed && selection.containsNode(target, true)) {
			allowTouchMove = true;
		}
		// range 슬라이더는 드래그 허용
		if (
			e.composedPath().some((el) => el instanceof HTMLInputElement && el.type === "range")
		) {
			allowTouchMove = true;
		}
	};

	const onTouchMove = (e: TouchEvent) => {
		if (e.touches.length === 2 || allowTouchMove) return; // 핀치줌 허용
		// 스크롤 불가 영역(=배경) → window 스크롤 차단
		if (
			!scrollable ||
			scrollable === document.documentElement ||
			scrollable === document.body
		) {
			e.preventDefault();
			return;
		}
		// overscroll-behavior 가 실제 오버플로 없는 요소에선 안 먹는 버그 보완
		if (
			scrollable.scrollHeight === scrollable.clientHeight &&
			scrollable.scrollWidth === scrollable.clientWidth
		) {
			e.preventDefault();
		}
	};

	const onBlur = (e: FocusEvent) => {
		const target = e.target as HTMLElement;
		const relatedTarget = e.relatedTarget as HTMLElement | null;
		if (relatedTarget && willOpenKeyboard(relatedTarget)) {
			relatedTarget.focus({ preventScroll: true });
			scrollIntoViewWhenReady(relatedTarget, willOpenKeyboard(target));
		} else if (!relatedTarget) {
			const focusable = target.parentElement?.closest(
				"[tabindex]",
			) as HTMLElement | null;
			focusable?.focus({ preventScroll: true });
		}
	};

	// iOS 26: overscroll-behavior 는 touchstart 전에 걸려 있어야 하므로 <style> 로 주입.
	const style = document.createElement("style");
	style.textContent = "@layer{*{overscroll-behavior:contain}}";
	document.head.prepend(style);

	// 프로그램적 focus 가 페이지를 스크롤하지 않도록 오버라이드.
	const nativeFocus = HTMLElement.prototype.focus;
	HTMLElement.prototype.focus = function (opts?: FocusOptions) {
		const active = document.activeElement;
		const wasKeyboardVisible = active != null && willOpenKeyboard(active);
		nativeFocus.call(this, { ...opts, preventScroll: true });
		if (!opts || !opts.preventScroll) {
			scrollIntoViewWhenReady(this, wasKeyboardVisible);
		}
	};

	const removeEvents = [
		addEvent(document, "touchstart", onTouchStart, { passive: false, capture: true }),
		addEvent(document, "touchmove", onTouchMove, { passive: false, capture: true }),
		addEvent(document, "blur", onBlur, true),
	];

	return () => {
		restoreOverflow();
		removeEvents.forEach((r) => r());
		style.remove();
		HTMLElement.prototype.focus = nativeFocus;
	};
}

function scrollIntoViewWhenReady(target: Element, wasKeyboardVisible: boolean) {
	if (wasKeyboardVisible || !vv) {
		scrollIntoView(target);
	} else {
		vv.addEventListener("resize", () => scrollIntoView(target), { once: true });
	}
}

function scrollIntoView(target: Element) {
	const root = document.scrollingElement || document.documentElement;
	let next: Element | null = target;
	while (next && next !== root) {
		const scrollable = getScrollParent(next);
		if (
			scrollable !== document.documentElement &&
			scrollable !== document.body &&
			scrollable !== next
		) {
			const scrollableRect = scrollable.getBoundingClientRect();
			const targetRect = next.getBoundingClientRect();
			if (
				targetRect.top < scrollableRect.top ||
				targetRect.bottom > scrollableRect.top + next.clientHeight
			) {
				let bottom = scrollableRect.bottom;
				if (vv) bottom = Math.min(bottom, vv.offsetTop + vv.height);
				const adjustment =
					targetRect.top -
					scrollableRect.top -
					((bottom - scrollableRect.top) / 2 - targetRect.height / 2);
				scrollable.scrollTo({
					top: Math.max(
						0,
						Math.min(
							scrollable.scrollHeight - scrollable.clientHeight,
							scrollable.scrollTop + adjustment,
						),
					),
					behavior: "smooth",
				});
			}
		}
		next = scrollable.parentElement;
	}
}

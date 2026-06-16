import { disassemble, getChoseong } from "es-hangul";

/**
 * 선수 이름이 검색어와 매칭되는지 판정. 대소문자 무시 + 한글 초성 검색 지원.
 * - 빈 검색어(공백 포함)는 항상 매칭.
 * - query가 전부 초성(ㄱ-ㅎ)이면 이름의 초성과 비교한다.
 *
 * query는 내부에서 trim+lowercase 처리하므로 호출자가 정규화할 필요 없다.
 */
export function matchesQuery(name: string, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	if (name.toLowerCase().includes(q)) return true;
	const decomposed = disassemble(q);
	const isAllChoseong = /^[ㄱ-ㅎ]+$/.test(decomposed);
	return isAllChoseong && getChoseong(name).includes(decomposed);
}

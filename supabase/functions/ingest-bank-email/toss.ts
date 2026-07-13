// 토스뱅크 거래내역 xlsx 파서 어댑터 (회계 §5).
// 시트 레이아웃(2026-07 실측):
//   행0~5: 계좌 요약(토스뱅크 거래내역/성명/계좌번호/조회기간/안내문)
//   행6 헤더: 거래 일시 | 적요 | 거래 유형 | 거래 기관 | 계좌번호 | 거래 금액 | 거래 후 잔액 | 메모
//   행7+: 데이터. 적요=입금자명(자유텍스트), 거래유형=입금/출금, 거래금액=정수, 거래 후 잔액=dedup 근거.

export type Cell = string | number | boolean | null;

export interface ParsedTxn {
  occurredAt: string; // ISO(+09:00)
  counterpartyName: string; // 적요(입금자명 원문)
  direction: "in" | "out";
  amount: number; // 원 정수(양수)
  balanceAfter: number | null;
  bankOrg: string | null; // 거래 기관(보낸/받는 은행)
  memo: string | null; // 사용자 메모
  dedupKey: string; // 거래 멱등 키
}

function parseAmount(v: Cell): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

// '2026.07.13 10:17:18' → '2026-07-13T10:17:18+09:00'
function parseTossDate(s: string): string {
  const m = s.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) throw new Error(`bad toss date: ${s}`);
  const p = (x: string) => x.padStart(2, "0");
  return `${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}:${m[6]}+09:00`;
}

export function parseToss(rows: Cell[][]): ParsedTxn[] {
  const norm = (c: Cell) => String(c ?? "").replace(/\s/g, "");
  const headerIdx = rows.findIndex((r) => norm(r?.[0]) === "거래일시");
  if (headerIdx < 0) throw new Error("toss header '거래 일시' not found");

  const out: ParsedTxn[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const dtRaw = String(r[0] ?? "").trim();
    if (!dtRaw) continue;
    // 방향은 거래유형 문자열이 아니라 **금액 부호**로 판단(입금/이자입금=+, 출금/모임원송금=−).
    const raw = parseAmount(r[5]);
    if (raw === null || raw === 0) continue;
    const direction: "in" | "out" = raw < 0 ? "out" : "in";
    const amount = Math.abs(raw); // 저장은 양수(스키마 amount>0), 방향은 direction 으로.

    const occurredAt = parseTossDate(dtRaw);
    const balanceAfter = parseAmount(r[6]);
    const txType = String(r[2] ?? "").trim(); // 입금/출금/모임원송금/이자입금 — 참고용(메모)
    const bankOrg = String(r[3] ?? "").trim();
    const userMemo = String(r[7] ?? "").trim();

    out.push({
      occurredAt,
      counterpartyName: String(r[1] ?? "").trim(),
      direction,
      amount,
      balanceAfter,
      bankOrg: bankOrg || null,
      memo: [txType, bankOrg, userMemo].filter(Boolean).join(" · ") || null,
      // 잔액까지 포함해 사실상 유일. (동일 시각·금액·잔액 거래는 같은 건으로 간주)
      dedupKey: `toss|${occurredAt}|${direction}|${amount}|${balanceAfter ?? ""}`,
    });
  }
  return out;
}

import type { ParsedTxn } from "./toss.ts";

// 복호화·XLSX 파싱은 CPU를 많이 쓴다. 첨부마다 별도 함수 실행으로 분리해
// 여러 메일의 CPU 사용량이 수집 함수의 2초 한도에 누적되지 않게 한다.
export async function parseAttachment(
  url: string,
  anonKey: string,
  authorization: string,
  bytesBase64: string,
): Promise<ParsedTxn[]> {
  const response = await fetch(`${url}/functions/v1/parse-bank-attachment`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bytesBase64 }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 546) {
      throw new Error("엑셀 한 개의 처리량이 서버 실행 한도를 초과했습니다. 거래내역 조회 기간을 줄여 다시 보내 주세요. (546)");
    }
    const detail = body?.error ?? body?.message ?? `HTTP ${response.status}`;
    throw new Error(`엑셀 처리 실패: ${detail}`);
  }
  if (!Array.isArray(body?.transactions)) {
    throw new Error("엑셀 처리 결과를 확인할 수 없습니다.");
  }
  return body.transactions;
}

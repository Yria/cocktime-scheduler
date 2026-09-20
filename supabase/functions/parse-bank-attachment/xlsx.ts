import officeCrypto from "officecrypto-tool";
import * as XLSX from "xlsx";
import { type Cell, parseToss } from "../ingest-bank-email/toss.ts";

export async function parseWorkbook(bytesBase64: string, password: string) {
  const enc = Buffer.from(bytesBase64, "base64");
  const dec = await officeCrypto.decrypt(enc, { password });
  const wb = XLSX.read(dec, {
    type: "array",
    sheets: 0,
    // 거래 값만 필요하다. 셀 서식·HTML·수식은 읽지 않아 CPU/메모리 사용을 줄인다.
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    cellFormula: false,
    cellText: false,
  });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: true,
  });
  return parseToss(rows);
}
import { Buffer } from "node:buffer";

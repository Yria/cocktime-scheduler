import { deepStrictEqual, rejects } from "node:assert/strict";
import { Buffer } from "node:buffer";
import officeCrypto from "officecrypto-tool";
import * as XLSX from "xlsx";
import { parseToss, type Cell } from "../ingest-bank-email/toss.ts";
import { parseWorkbook } from "./xlsx.ts";

const rows: Cell[][] = [
  ["토스뱅크 거래내역"],
  ["거래 일시", "적요", "거래 유형", "거래 기관", "계좌번호", "거래 금액", "거래 후 잔액", "메모"],
  ...Array.from({ length: 3000 }, (_, i) => [
    `2026.09.14 10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`,
    `테스트${i}`, i % 2 ? "출금" : "입금", "토스뱅크", "", i % 2 ? -6000 : 12000,
    100000 + i * 3000, "테스트 메모",
  ]),
];
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "거래내역");
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["읽지 않는 시트"]]), "안내");
const bytes: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
const encrypted = Buffer.from(await officeCrypto.encrypt(bytes, { password: "123456" })).toString("base64");

Deno.test("encrypted workbook preserves all 3000 transactions and dedup keys", async () => {
  deepStrictEqual(await parseWorkbook(encrypted, "123456"), parseToss(rows));
});

Deno.test("a wrong password fails instead of returning an empty successful import", async () => {
  await rejects(() => parseWorkbook(encrypted, "wrong-password"));
});

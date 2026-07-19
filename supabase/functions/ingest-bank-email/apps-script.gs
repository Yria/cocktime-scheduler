// 토스뱅크 거래내역 xlsx 리더 — firea32@gmail.com 에 배포하는 Apps Script 웹앱.
// 배포/운영: docs/BANK_EMAIL_INGEST.md. 원칙 = "Gmail 에서 찾아 원문(첨부 바이트)만 반환 + 적재 성공분 휴지통 정리".
//
// [배포]
//   1) https://script.google.com → 새 프로젝트, 이 코드 붙여넣기.
//   2) INGEST_SECRET 를 긴 랜덤 문자열로 교체(예: 터미널 `openssl rand -hex 24`).
//      ※ 나중에 Edge Function 의 INGEST_SECRET 과 반드시 동일해야 함.
//   3) 배포 > 새 배포 > 유형 "웹 앱" · 실행: 나(firea32) · 액세스: 모든 사용자 → 배포.
//   4) 첫 배포 시 Gmail 권한 동의(1회). ※ 스코프가 gmail.modify(읽기+휴지통)로 상향됨 — 기존 배포라면
//      편집기에서 authorize() 를 1회 실행해 '수정' 권한을 재동의해야 trash 가 동작(안 하면 moveToTrash 실패).
//   5) 나온 "웹 앱 URL"을 저장(Edge Function 에 넣을 값).
//
// [Gmail 큐 정의]
//   토스가 자동 발송하는 고정 제목 "[토스뱅크] 요청하신 거래내역 엑셀파일을 보내드립니다." 로 매칭 →
//   라벨/필터 설정 불필요. SEARCH_QUERY 가 미처리 대상을 정의(제목 3개 키워드 AND + xlsx 첨부 + 90일 이내).
//   중복 재수집은 DB dedup_key 가 거른다. 처리 후 정리: Edge Function 이 적재 성공(에러 없음)을 확정한
//   메일만 2차 호출(action:'trash', messageIds[])로 휴지통 이동 → 파싱 실패분은 남겨 유실 방지(휴지통 30일 복구).
//   (trash 된 메일은 GmailApp.search 기본 제외라 다음 수집에서 재조회되지도 않음.)
//   ※ 첨부 xlsx 는 암호보호(토스: 생일 6자리). 복호화·파싱은 Edge Function 담당 — 여기선 원문 바이트만 반환.
//
// [테스트]
//   · 브라우저로 웹 앱 URL 열기 → doGet: {"ok":true,"message":"toss ingest ready"} 면 배포 OK.
//   · 읽기 테스트(터미널):
//       curl -sX POST '<웹앱URL>' -H 'Content-Type: application/json' \
//         -d '{"secret":"<INGEST_SECRET>","max":5}'
//     → {"ok":true,"count":N,"messages":[{subject,from,date,attachments:[{name,size,...}]}]}

const INGEST_SECRET = 'CHANGE_ME_긴랜덤문자열_openssl_rand_hex_24';
const SEARCH_QUERY = 'subject:(토스뱅크 거래내역 엑셀파일) has:attachment filename:xlsx newer_than:90d';
const MAX_DEFAULT = 10;
const MAX_CAP = 25;

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // Apps Script 웹앱은 커스텀 헤더를 못 읽으므로 시크릿을 본문으로 받는다.
    if (body.secret !== INGEST_SECRET) {
      return json({ ok: false, error: 'forbidden' });
    }
    // 정리(2차 호출): 적재 성공이 확정된 messageId 만 휴지통으로. 개별 실패(이미 삭제·권한 등)는 무시.
    if (body.action === 'trash') {
      const ids = Array.isArray(body.messageIds) ? body.messageIds : [];
      let trashed = 0;
      for (let i = 0; i < ids.length; i++) {
        try {
          const msg = GmailApp.getMessageById(ids[i]);
          if (msg) { msg.moveToTrash(); trashed++; }
        } catch (err) { /* skip */ }
      }
      return json({ ok: true, trashed: trashed });
    }
    const max = Math.min(Number(body.max) || MAX_DEFAULT, MAX_CAP);
    const threads = GmailApp.search(SEARCH_QUERY, 0, max);
    const messages = [];
    for (const th of threads) {
      for (const msg of th.getMessages()) {
        const atts = msg.getAttachments().filter(function (a) {
          return /\.xlsx$/i.test(a.getName());
        });
        if (atts.length === 0) continue;
        messages.push({
          messageId: msg.getId(),
          subject: msg.getSubject(),
          from: msg.getFrom(),
          date: msg.getDate().toISOString(),
          attachments: atts.map(function (a) {
            return {
              name: a.getName(),
              size: a.getSize(),
              mimeType: a.getContentType(),
              // xlsx 원문 바이트(base64). 파싱은 Edge Function 담당.
              bytesBase64: Utilities.base64Encode(a.getBytes()),
            };
          }),
        });
      }
    }
    return json({ ok: true, count: messages.length, messages: messages });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, message: 'toss ingest ready' });
}

// Gmail 스코프(gmail.modify=읽기+휴지통) 승인 트리거용. 편집기에서 이 함수를 1회 "실행(Run)"하면 동의창이 뜬다.
// ※ 스코프 상향(readonly→modify) 후엔 반드시 재실행해 '수정' 권한을 재동의해야 trash 가 동작한다.
// (execute-as-me 웹앱이 GmailApp 을 쓰려면 소유자가 gmail 스코프를 승인해야 함 → 안 하면 doPost 가
//  구글 레벨에서 막혀 "현재 파일을 열 수 없습니다" 에러. 승인은 계정 단위라 승인 후 재배포 불필요.)
function authorize() {
  const n = GmailApp.search('in:inbox', 0, 1).length;
  Logger.log('gmail authorized, sample threads: ' + n);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

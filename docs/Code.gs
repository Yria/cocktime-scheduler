// Google Apps Script - 선수 스킬 수정 엔드포인트
// 배포: 확장 > Apps Script > 배포 > 새 배포 > 웹 앱
//   - 실행 계정: 나(시트 소유자)
//   - 액세스 권한: 모든 사용자

const SHEET_NAME = 'Sheet1' // 실제 시트명으로 변경

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents)
    const { name, skills } = data

    if (!name || !skills) {
      return jsonResponse({ ok: false, error: 'name, skills 필수' })
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
    const rows = sheet.getDataRange().getValues()
    const headers = rows[0] // ['이름', '성별', '클리어', '스매시', ...]

    const rowIndex = rows.findIndex((row, i) => i > 0 && row[0] === name)
    if (rowIndex === -1) {
      return jsonResponse({ ok: false, error: `선수 없음: ${name}` })
    }

    for (const [skill, value] of Object.entries(skills)) {
      const colIndex = headers.indexOf(skill)
      if (colIndex !== -1) {
        sheet.getRange(rowIndex + 1, colIndex + 1).setValue(value)
      }
    }

    return jsonResponse({ ok: true })
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message })
  }
}

function doGet() {
  return jsonResponse({ ok: true, message: 'Apps Script 연결됨' })
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
}

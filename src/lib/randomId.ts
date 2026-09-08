import { v4 as uuidv4 } from "uuid";

/**
 * UUID(v4) 생성. `crypto.randomUUID` 를 직접 부르지 않는 이유가 있다 — 그 API 는
 * **보안 컨텍스트(HTTPS·localhost)에서만 존재**해서, 폰에서 `http://192.168.x.x:5173`
 * 같은 LAN 주소로 개발 서버에 붙거나 구형 iOS Safari(15.4 미만)·일부 WebView 에서는
 * 함수 자체가 없고 "crypto.randomUUID is not a function" 으로 죽는다.
 *
 * `uuid` 패키지가 그 분기를 대신 처리한다: 네이티브 `crypto.randomUUID` 가 있으면 그걸
 * 쓰고, 없으면 `crypto.getRandomValues`(비보안 컨텍스트에서도 존재)로 RFC9562 v4 를
 * 만든다. 포맷은 동일하므로 편집 락 식별자·회계 멱등 요청 ID 처럼 서버가 uuid 타입으로
 * 받는 값에 그대로 쓸 수 있다.
 *
 * 새 코드도 `crypto.randomUUID()` 대신 이 함수를 쓴다.
 */
export function randomId(): string {
	return uuidv4();
}

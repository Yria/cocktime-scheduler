// VAPID 키 1회 생성 헬퍼.
//   실행:  deno run scripts/gen-vapid-keys.ts
//
// 출력 2개:
//   1) VAPID_KEYS            → Edge Function secret (JWK JSON 통째로)
//        supabase secrets set VAPID_KEYS='<...>' VAPID_SUBJECT=mailto:sam@dooub.com PUSH_SEND_SECRET=<랜덤32B>
//   2) VITE_VAPID_PUBLIC_KEY → 프론트 빌드 env (base64url 공개키)
//        GitHub repo Secrets + 로컬 .env.local
import * as webpush from "jsr:@negrel/webpush@^0.3";

// private key를 export 하려면 extractable: true 로 생성해야 한다.
const keys = await webpush.generateVapidKeys({ extractable: true });
const exported = await webpush.exportVapidKeys(keys); // { publicKey, privateKey } JWK

// 클라이언트 applicationServerKey = uncompressed EC 공개점(65B)을 base64url로.
const raw = await crypto.subtle.exportKey("raw", keys.publicKey);
const publicKey = btoa(String.fromCharCode(...new Uint8Array(raw)))
	.replace(/\+/g, "-")
	.replace(/\//g, "_")
	.replace(/=+$/, "");

console.log("=== VAPID_KEYS  (Edge Function secret · JWK JSON) ===");
console.log(JSON.stringify(exported));
console.log("\n=== VITE_VAPID_PUBLIC_KEY  (client build env · base64url) ===");
console.log(publicKey);

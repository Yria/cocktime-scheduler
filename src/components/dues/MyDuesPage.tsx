import { Navigate, useParams } from "react-router-dom";

/**
 * 옛 회원 회비 주소(/my-dues, /my-dues/ledger) → 내 정보(/me)의 회비·클럽 회계 탭.
 * 푸시 알림·홈 화면 북마크·카톡에 붙여 둔 옛 링크가 살아 있어야 해서 라우트를 지우지 않고 넘겨준다
 * (docs/MATCH_RESULT_ELO_SPEC.md §3.5). 회계 모드 확인·로그인 가드는 /me 쪽이 한다.
 */
export default function MyDuesPage() {
	const { page } = useParams<{ page: string }>();
	return <Navigate to={page === "ledger" ? "/me/ledger" : "/me/dues"} replace />;
}

import type { Session, User } from "@supabase/supabase-js";
import { create } from "zustand";
import { supabase } from "../lib/supabase/client";

interface AuthState {
	user: User | null;
	session: Session | null;
	/** 초기 세션 확인(getSession) 완료 여부 */
	ready: boolean;
	/** 회원정보(memberId·isAdmin) 로드 완료 여부. ready 이후 비동기로 채워지므로 가드는 이걸 기다려야 함. */
	memberLoaded: boolean;
	/** 로그인 사용자의 members.id (없으면 null) */
	memberId: string | null;
	/** 운영진 여부 */
	isAdmin: boolean;
	/** 내 이름(가입 시 카카오 이름으로 채워짐, 프로필에서 수정 가능) */
	myName: string | null;
	/** 내 프로필 성별(없으면 null → 세션 편입 전 입력 필요) */
	myGender: "M" | "F" | null;
	/** 내 출생년도(가입 후 입력) */
	myBirthYear: number | null;
	/** 내 거주지(동 단위, 가입 후 입력) */
	myResidence: string | null;
	/** 내 가입일 보정값(members.membership_started_at, date "YYYY-MM-DD"). 신규 유예 판정용. */
	myMembershipStartedAt: string | null;
	/** 내 계정 생성 시각(ISO). membership_started_at 이 없을 때의 가입일 소스. */
	myCreatedAt: string | null;
}

export const useAuthStore = create<AuthState>(() => ({
	user: null,
	session: null,
	ready: false,
	memberLoaded: false,
	memberId: null,
	isAdmin: false,
	myName: null,
	myGender: null,
	myBirthYear: null,
	myResidence: null,
	myMembershipStartedAt: null,
	myCreatedAt: null,
}));

let initialized = false;

// 회원 조회를 이미 끝냈거나 진행 중인 auth user id. onAuthStateChange 는 구독 즉시 INITIAL_SESSION 을
// 쏘고, 그 뒤로도 TOKEN_REFRESHED(시간당)·다른 탭 BroadcastChannel·재포커스마다 다시 발화한다.
// 그때마다 loadMember 를 돌리면 upsert+select+is_admin 세 번이 통째로 반복된다 —
// 실측(2026-08-16~17) POST members 1,487 / GET members 2,409 / rpc is_admin 1,798회. 회원은 149명뿐이다.
let memberLoadFor: string | null = null;
// members 행 보장(멱등 upsert)을 이미 끝낸 auth user id. 브라우저 수명 동안 1회면 충분하다.
let memberEnsuredFor: string | null = null;

/** 로그인 사용자의 members 행을 보장하고 member_id·운영진 여부를 store에 채운다. */
async function loadMember(user: User) {
	// 본인 member 행 보장 (RLS members_insert). 이미 있으면 무시.
	if (memberEnsuredFor !== user.id) {
		await supabase
			.from("members")
			.upsert(
				{ auth_user_id: user.id, name: authDisplayName(user) },
				{ onConflict: "auth_user_id", ignoreDuplicates: true },
			);
		memberEnsuredFor = user.id;
	}
	const { data: member } = await supabase
		.from("members")
		// membership_started_at·created_at = 신규회원 2주 프리패스 안내 노출 판정(isNewbieNowKST) 소스.
		.select("id, name, gender, birth_year, residence, membership_started_at, created_at")
		.eq("auth_user_id", user.id)
		.maybeSingle();
	const { data: admin } = await supabase.rpc("is_admin");
	// 행이 안 보이면(upsert 실패·RLS·최초 가입 레이스) 다음 이벤트에서 보장부터 다시 시도한다.
	if (!member) memberEnsuredFor = null;
	useAuthStore.setState({
		memberLoaded: true,
		memberId: (member?.id as string | undefined) ?? null,
		isAdmin: admin === true,
		myName: (member?.name as string | null | undefined) ?? null,
		myGender: (member?.gender as "M" | "F" | null | undefined) ?? null,
		myBirthYear: (member?.birth_year as number | null | undefined) ?? null,
		myResidence: (member?.residence as string | null | undefined) ?? null,
		myMembershipStartedAt:
			(member?.membership_started_at as string | null | undefined) ?? null,
		myCreatedAt: (member?.created_at as string | null | undefined) ?? null,
	});
}

function applySession(session: Session | null) {
	useAuthStore.setState({
		session,
		user: session?.user ?? null,
		ready: true,
	});
	if (session?.user) {
		const u = session.user;
		// 같은 사용자로 이벤트가 또 와도(토큰 갱신·다른 탭·재포커스) 회원 조회는 다시 하지 않는다.
		if (memberLoadFor === u.id) return;
		memberLoadFor = u.id;
		// onAuthStateChange 콜백 내에서 supabase를 직접 await하면 데드락 위험 → 디퍼.
		setTimeout(() => {
			void loadMember(u).catch((e) => {
				// 실패한 사용자는 잠가두지 않는다 — 다음 auth 이벤트에서 다시 시도해야 memberLoaded 가 풀린다.
				console.error("loadMember:", e);
				if (memberLoadFor === u.id) memberLoadFor = null;
			});
		}, 0);
	} else {
		// 비로그인: 로드할 회원정보가 없으므로 즉시 settled 처리.
		memberLoadFor = null;
		memberEnsuredFor = null;
		useAuthStore.setState({ memberId: null, isAdmin: false, memberLoaded: true });
	}
}

export const authActions = {
	/** 앱 마운트 시 1회 호출: 저장된 세션 복원 + 이후 변경 구독. */
	init() {
		if (initialized) return;
		initialized = true;

		// onAuthStateChange 는 구독 즉시 INITIAL_SESSION(복원된 세션)을 발화한다 —
		// 별도 getSession() 은 같은 세션을 한 번 더 흘려보내 loadMember 를 2중 실행할 뿐이다.
		// (실측 로그에 1ms 간격 POST members 쌍으로 남아 있었다.)
		supabase.auth.onAuthStateChange((_event, session) => {
			applySession(session);
		});
	},

	/** 카카오 로그인. 성공 시 카카오로 리다이렉트되며, 콜백에서 detectSessionInUrl이 세션을 확립한다. */
	async signInWithKakao() {
		// 배포: https://<user>.github.io/cocktime-scheduler/ , 로컬: http://localhost:5173/
		const redirectTo = window.location.origin + import.meta.env.BASE_URL;
		const { error } = await supabase.auth.signInWithOAuth({
			provider: "kakao",
			options: { redirectTo },
		});
		if (error) throw error;
	},

	async signOut() {
		await supabase.auth.signOut();
	},

	/**
	 * 회원 탈퇴(=본인 요청 비활성). 계정을 지우지 않는다 — `is_active=false` + 미종료 세션 참석 취소 +
	 * 푸시 구독 삭제까지만 하고 회원 행·개인정보·부과 이력은 남긴다(`deactivate_my_account`).
	 * 운영진 [비활성] 과 같은 처리라, 돌아오면 [재활성화] 로 복구된다 — 계정을 지우면 재가입 때
	 * members 행이 하나 더 생겨 회비 이력이 끊긴다(구 `delete_my_account` 는 봉인, 20260821020000).
	 */
	async deactivateAccount() {
		const { error } = await supabase.rpc("deactivate_my_account");
		if (error) {
			console.error("deactivateAccount:", error);
			return false;
		}
		// 계정은 남아 있지만 본인은 나간 상태 → 로컬 세션 정리(onAuthStateChange가 로그인 화면으로 복귀)
		await supabase.auth.signOut();
		return true;
	},

	/** 가입 후 프로필 입력(이름·성별·출생년도·거주지). 세션 편입 전 필수. */
	async updateProfile(profile: {
		name: string;
		gender: "M" | "F";
		birthYear: number;
		residence: string;
	}) {
		const user = useAuthStore.getState().user;
		if (!user) return false;
		const { error } = await supabase
			.from("members")
			.update({
				name: profile.name,
				gender: profile.gender,
				birth_year: profile.birthYear,
				residence: profile.residence,
			})
			.eq("auth_user_id", user.id);
		if (error) {
			console.error("updateProfile:", error);
			return false;
		}
		useAuthStore.setState({
			myName: profile.name,
			myGender: profile.gender,
			myBirthYear: profile.birthYear,
			myResidence: profile.residence,
		});
		return true;
	},
};

/** 카카오 user_metadata에서 표시 이름 추출. */
export function authDisplayName(user: User | null): string {
	if (!user) return "";
	const m = (user.user_metadata ?? {}) as Record<string, unknown>;
	return (
		(m.name as string) ||
		(m.nickname as string) ||
		(m.full_name as string) ||
		(m.preferred_username as string) ||
		"회원"
	);
}

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
}));

let initialized = false;

/** 로그인 사용자의 members 행을 보장하고 member_id·운영진 여부를 store에 채운다. */
async function loadMember(user: User) {
	// 본인 member 행 보장 (RLS members_self_insert). 이미 있으면 무시.
	await supabase
		.from("members")
		.upsert(
			{ auth_user_id: user.id, name: authDisplayName(user) },
			{ onConflict: "auth_user_id", ignoreDuplicates: true },
		);
	const { data: member } = await supabase
		.from("members")
		.select("id, name, gender, birth_year, residence")
		.eq("auth_user_id", user.id)
		.maybeSingle();
	const { data: admin } = await supabase.rpc("is_admin");
	useAuthStore.setState({
		memberLoaded: true,
		memberId: (member?.id as string | undefined) ?? null,
		isAdmin: admin === true,
		myName: (member?.name as string | null | undefined) ?? null,
		myGender: (member?.gender as "M" | "F" | null | undefined) ?? null,
		myBirthYear: (member?.birth_year as number | null | undefined) ?? null,
		myResidence: (member?.residence as string | null | undefined) ?? null,
	});
}

function applySession(session: Session | null) {
	useAuthStore.setState({
		session,
		user: session?.user ?? null,
		ready: true,
	});
	if (session?.user) {
		// onAuthStateChange 콜백 내에서 supabase를 직접 await하면 데드락 위험 → 디퍼.
		const u = session.user;
		setTimeout(() => {
			void loadMember(u);
		}, 0);
	} else {
		// 비로그인: 로드할 회원정보가 없으므로 즉시 settled 처리.
		useAuthStore.setState({ memberId: null, isAdmin: false, memberLoaded: true });
	}
}

export const authActions = {
	/** 앱 마운트 시 1회 호출: 저장된 세션 복원 + 이후 변경 구독. */
	init() {
		if (initialized) return;
		initialized = true;

		supabase.auth.getSession().then(({ data }) => {
			applySession(data.session);
		});

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

	/** 회원 탈퇴: 회원 데이터 + 인증 사용자 삭제 후 로컬 세션 정리(되돌릴 수 없음). */
	async deleteAccount() {
		const { error } = await supabase.rpc("delete_my_account");
		if (error) {
			console.error("deleteAccount:", error);
			return false;
		}
		// 서버에서 사용자 삭제됨 → 로컬 세션 정리(onAuthStateChange가 로그인 화면으로 복귀)
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

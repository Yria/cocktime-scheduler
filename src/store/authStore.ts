import type { Session, User } from "@supabase/supabase-js";
import { create } from "zustand";
import { supabase } from "../lib/supabase/client";

interface AuthState {
	user: User | null;
	session: Session | null;
	/** 초기 세션 확인(getSession) 완료 여부 */
	ready: boolean;
	/** 로그인 사용자의 members.id (없으면 null) */
	memberId: string | null;
	/** 운영진 여부 */
	isAdmin: boolean;
	/** 내 프로필 성별(없으면 null → 세션 편입 전 입력 필요) */
	myGender: "M" | "F" | null;
}

export const useAuthStore = create<AuthState>(() => ({
	user: null,
	session: null,
	ready: false,
	memberId: null,
	isAdmin: false,
	myGender: null,
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
		.select("id, gender")
		.eq("auth_user_id", user.id)
		.maybeSingle();
	const { data: admin } = await supabase.rpc("is_admin");
	useAuthStore.setState({
		memberId: (member?.id as string | undefined) ?? null,
		isAdmin: admin === true,
		myGender: (member?.gender as "M" | "F" | null | undefined) ?? null,
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
		useAuthStore.setState({ memberId: null, isAdmin: false });
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

	/** 내 프로필 성별 설정(세션 편입 전 필수). */
	async updateGender(gender: "M" | "F") {
		const user = useAuthStore.getState().user;
		if (!user) return false;
		const { error } = await supabase
			.from("members")
			.update({ gender })
			.eq("auth_user_id", user.id);
		if (error) {
			console.error("updateGender:", error);
			return false;
		}
		useAuthStore.setState({ myGender: gender });
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

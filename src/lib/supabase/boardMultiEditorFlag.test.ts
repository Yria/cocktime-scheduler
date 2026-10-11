import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// 20261012010000_board_multi_editor_flag.sql 의 실제 함수 본문을 로컬 PGlite 에서 실행한다.
// 플래그 OFF 는 기존과 같은 결과(editor_* 갱신·self-claim 포함), ON 은 운영진 전원 편집·editor_* 미사용을 확인한다.
// 앞선 가드 마이그레이션(20261012000000)도 함께 올려 배포 순서대로 재현한다.
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const read = (name: string) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");
const ADMIN = uid(1), ADMIN2 = uid(3), MEMBER = uid(2);
let db: PGlite;

async function as(user: string) { await db.query("select set_config('test.user',$1,true)", [user]); }
async function session() {
	return (await db.query<{ editor_client_id: string | null; editor_name: string | null; board_drafts_version: number;
		sync_version: number; board_multi_editor: boolean; board_drafts: unknown }>("select * from sessions where id=1")).rows[0];
}
async function save(client: string, base: number, payload: unknown = { teams: [], reservations: [] }) {
	return (await db.query<{ v: number | null }>("select public.board_save_drafts(1,$1,'이름',$2::jsonb,$3) v",
		[client, JSON.stringify(payload), base])).rows[0].v;
}
async function lockRpc(sql: string, params: unknown[]) {
	return (await db.query<{ o_client_id: string }>(sql, params)).rows;
}
async function fails(run: () => Promise<unknown>, message: RegExp) {
	await db.exec("savepoint expected_failure");
	await expect(run()).rejects.toThrow(message);
	await db.exec("rollback to savepoint expected_failure");
}
async function setFlag(on: boolean) {
	return (await db.query<{ r: boolean }>("select public.admin_set_board_multi_editor(1,$1) r", [on])).rows[0].r;
}

beforeAll(async () => {
	db = new PGlite();
	await db.exec(`
		create role anon; create role authenticated;
		create schema auth;
		create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user', true), '')::uuid$$;
		create table public.members(id uuid primary key, auth_user_id uuid, is_active boolean default true);
		create table public.user_roles(member_id uuid, role text);
		create function public.is_admin() returns boolean language sql as $$
			select exists(select 1 from public.user_roles ur join public.members m on m.id = ur.member_id
				where m.auth_user_id = auth.uid() and ur.role = 'admin')$$;
		create table public.sessions(id bigint primary key, is_active boolean default true, status text default 'active',
			court_count int default 2, cock_check_enabled boolean default true,
			editor_client_id text, editor_name text, editor_lease_until timestamptz,
			board_drafts jsonb, board_drafts_version bigint not null default 0,
			match_assign_count int default 0, match_state_version int not null default 0, sync_version bigint not null default 0);
		create table public.session_players(id uuid primary key, session_id bigint references public.sessions, member_id uuid,
			name text, status text default 'waiting', game_count int default 0, mixed_count int default 0,
			cock_checked boolean default true, wait_since timestamptz, gender text, skills jsonb);
		create table public.matches(id uuid primary key, session_id bigint references public.sessions, court_id int, game_type text,
			team_a_p1 uuid, team_a_p2 uuid, team_b_p1 uuid, team_b_p2 uuid, status text,
			ended_at timestamptz, player_snapshot jsonb, assigned_by text);
		create table public.member_party_rounds(session_id bigint primary key, round_id uuid, ends_at timestamptz, last_result jsonb);
		create table public.member_party_holds(session_id bigint, user_id uuid, client_id text, board_client_id text,
			player_id uuid, round_id uuid, lease_until timestamptz, primary key (session_id, user_id, client_id));
		-- 이 마이그레이션이 바꾸지 않는 회원 파티 헬퍼는 최소 스텁으로 둔다.
		create function public._member_party_player_reason(bigint, uuid) returns text language sql as $$select null::text$$;
		create function public._member_party_close(bigint, jsonb) returns void language sql as $$select$$;
		create function public.member_party_state(p_session_id bigint) returns jsonb language plpgsql as $$
			begin return public._member_party_snapshot(p_session_id); end $$;
	`);
	await db.exec(read("20261012000000_board_match_guards.sql"));
	await db.exec(read("20261012010000_board_multi_editor_flag.sql"));
	await db.exec(`
		create trigger trg_sessions_bump_sync before update on public.sessions
			for each row execute function public.sessions_bump_sync_version();
	`);
});
beforeEach(async () => {
	await db.exec("begin");
	await db.query("insert into members(id,auth_user_id) values($1,$1),($2,$2),($3,$3)", [ADMIN, MEMBER, ADMIN2]);
	await db.query("insert into user_roles values($1,'admin'),($2,'admin')", [ADMIN, ADMIN2]);
	await db.exec("insert into sessions(id) values(1)");
	await as(ADMIN);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

describe("플래그 OFF — 기존 동작 그대로", () => {
	it("컬럼 기본값은 false 이고 스냅샷에 실린다", async () => {
		expect((await session()).board_multi_editor).toBe(false);
		const snap = (await db.query<{ s: Record<string, unknown> }>("select public.load_session_state(1) s")).rows[0].s;
		expect(snap.board_multi_editor).toBe(false);
	});
	it("저장은 self-claim 하고 다른 편집자가 있으면 0행(null)", async () => {
		expect(await save("a", 0)).toBe(1);
		expect((await session()).editor_client_id).toBe("a");
		expect(await save("b", 1)).toBeNull();
		await as(MEMBER);
		expect(await save("a", 1)).toBeNull();
	});
	it("경기 가드는 자유면 self-claim, 남이 보유하면 거부", async () => {
		await db.query("select public.board_assert_editor(1,'a','이름',20)");
		expect((await session()).editor_client_id).toBe("a");
		await as(ADMIN2);
		await fails(() => db.query("select public.board_assert_editor(1,'b','이름',20)"), /not editor/);
	});
	it("claim/takeover/handoff 는 editor_* 를 쓴다", async () => {
		expect(await lockRpc("select * from public.board_claim_editor(1,'a','A',20)", [])).toHaveLength(1);
		expect(await lockRpc("select * from public.board_handoff_editor(1,'a','b','B',20)", [])).toHaveLength(1);
		expect(await lockRpc("select * from public.board_takeover_editor(1,'c','C',20)", [])).toHaveLength(1);
		expect((await session()).editor_client_id).toBe("c");
	});
});

describe("admin_set_board_multi_editor", () => {
	it("플래그와 editor_* 정리를 한 번에 하고 sync_version 을 올린다", async () => {
		await save("a", 0);
		const before = await session();
		expect(await setFlag(true)).toBe(true);
		const after = await session();
		expect(after).toMatchObject({ board_multi_editor: true, editor_client_id: null, editor_name: null });
		expect(Number(after.board_drafts_version)).toBe(Number(before.board_drafts_version) + 1);
		expect(Number(after.sync_version)).toBeGreaterThan(Number(before.sync_version));
	});
	it("전환 전에 출발한 저장은 전환 뒤 도착해도 CAS 로 실패한다(편집권을 잡지 않음)", async () => {
		await setFlag(true);
		expect(await save("a", 0)).toBeNull(); // 토글이 버전을 1 올렸다 — 전환 전 base 는 충돌
		expect(await save("a", 1)).toBe(2);
		await as(ADMIN2);
		await setFlag(false);
		await as(ADMIN);
		expect(await save("a", 2)).toBeNull(); // ON 에서 출발한 낡은 base
		expect((await session()).editor_client_id).toBeNull();
	});
	it("같은 값이면 아무것도 쓰지 않는다(현재 편집자를 내쫓지 않음)", async () => {
		await save("a", 0);
		const before = await session();
		expect(await setFlag(false)).toBe(false);
		expect(await session()).toMatchObject({ editor_client_id: "a", sync_version: before.sync_version });
	});
	it("회원·없는 세션은 거부", async () => {
		await fails(() => db.query("select public.admin_set_board_multi_editor(99,true)"), /session not found/);
		await as(MEMBER);
		await fails(() => setFlag(true), /admin only/);
	});
});

describe("플래그 ON — 운영진 동시 편집", () => {
	beforeEach(async () => { await setFlag(true); });
	it("운영진 누구나 버전 CAS 만으로 저장하고 editor_* 는 그대로 비어 있다", async () => {
		expect(await save("a", 1)).toBe(2); // 토글이 버전을 1 올렸다
		await as(ADMIN2);
		expect(await save("b", 2)).toBe(3);
		expect(await save("b", 2)).toBeNull(); // 낡은 base 는 여전히 충돌
		expect(await session()).toMatchObject({ editor_client_id: null, editor_name: null });
	});
	it("회원은 저장할 수 없다", async () => {
		await as(MEMBER);
		expect(await save("m", 0)).toBeNull();
	});
	it("경기 가드는 운영진만 통과시키고 self-claim 하지 않는다", async () => {
		await db.query("select public.board_assert_editor(1,'a','이름',20)");
		await as(ADMIN2);
		await db.query("select public.board_assert_editor(1,'b','이름',20)");
		await db.query("select public.board_assert_editor(1,null,null,20)");
		expect((await session()).editor_client_id).toBeNull();
		await as(MEMBER);
		await fails(() => db.query("select public.board_assert_editor(1,'m','이름',20)"), /not editor/);
	});
	it("claim/takeover/handoff 는 no-op(0행)", async () => {
		expect(await lockRpc("select * from public.board_claim_editor(1,'a','A',20)", [])).toHaveLength(0);
		expect(await lockRpc("select * from public.board_takeover_editor(1,'a','A',20)", [])).toHaveLength(0);
		await db.exec("update sessions set editor_client_id='a' where id=1");
		expect(await lockRpc("select * from public.board_handoff_editor(1,'a','b','B',20)", [])).toHaveLength(0);
		expect((await session()).editor_client_id).toBe("a");
	});
	it("끄면 바로 기존 단일 편집자 규칙으로 돌아간다", async () => {
		await setFlag(false);
		expect(await save("a", 2)).toBe(3);
		expect((await session()).editor_client_id).toBe("a");
		await as(ADMIN2);
		expect(await save("b", 3)).toBeNull();
	});
	it("스냅샷에 플래그가 실린다", async () => {
		const snap = (await db.query<{ s: Record<string, unknown> }>("select public.load_session_state(1) s")).rows[0].s;
		expect(snap).toMatchObject({ board_multi_editor: true, editor_client_id: null });
	});
});

describe("회원 파티 — ON 에서는 운영진 기기를 편집자로 본다", () => {
	beforeEach(async () => {
		await db.query("insert into session_players(id,session_id,member_id,name) values($1,1,$2,'운영진'),($3,1,$4,'회원')",
			[uid(11), ADMIN, uid(12), MEMBER]);
		// 운영진이 모두 경기 중이어야 회원 파티가 열린다(스텁 사유 함수는 선수 자격을 따지지 않는다).
		await db.query("insert into matches(id,session_id,court_id,team_a_p1,status) values($1,1,1,$2,'playing')", [uid(50), uid(11)]);
		await db.query("insert into member_party_rounds values(1,$1,now()+interval '5 seconds',null)", [uid(99)]);
		await db.query("insert into member_party_holds values(1,$1,'c1','b1',$2,$3,now()+interval '3 seconds'),(1,$4,'c2','b2',$5,$3,now()+interval '3 seconds')",
			[ADMIN, uid(11), uid(99), MEMBER, uid(12)]);
	});
	const participants = async () =>
		(await db.query<{ s: { participants: string[] } }>("select public._member_party_snapshot(1) s")).rows[0].s.participants;
	it("OFF: editor_client_id 와 다른 기기의 운영진 누름은 참가자다", async () => {
		expect(await participants()).toEqual([uid(11), uid(12)].sort());
	});
	it("ON: 운영진 누름은 빠지고 회원만 남는다", async () => {
		await setFlag(true);
		expect(await participants()).toEqual([uid(12)]);
	});
	it("ON: 운영진의 누름 요청은 'editor' 사유로 거절하고 회원은 그대로", async () => {
		await setFlag(true);
		const admin = (await db.query<{ s: Record<string, unknown> }>("select public.member_party_hold(1,'c1',true,null,'b1') s")).rows[0].s;
		expect(admin).toMatchObject({ eligible: false, reason: "editor" });
		await as(MEMBER);
		const member = (await db.query<{ s: Record<string, unknown> }>("select public.member_party_hold(1,'c2',true,null,'b2') s")).rows[0].s;
		expect(member.reason).not.toBe("editor");
	});
	it("ON: 운영진은 파티를 확정할 수 없다", async () => {
		await setFlag(true);
		await fails(() => db.query("select public.member_party_finish(1,$1,array[]::uuid[],0,'b1')", [uid(99)]),
			/editor cannot create member party/);
	});
});

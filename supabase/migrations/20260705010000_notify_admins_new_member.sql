-- 신규 회원 가입 시 운영진(admin)에게 푸시 알림:
-- members 프로필 필수 3필드(gender/birth_year/residence)가 NULL→채워짐으로 "최초 완성"되는
-- 순간(=가입 확정, ProfileSetup signup) 운영진 전원에게 'new_member' 알림을 INSERT 한다.
-- notifications INSERT 트리거(trg_notify_push_send)가 send-push Edge Function 을 호출해 웹푸시까지 이어진다.
--
-- 발화 시점을 "프로필 완성"으로 잡은 이유: 최초 로그인 시 loadMember() 는 members 를 껍데기(3필드 NULL)로
-- INSERT 하므로(AFTER UPDATE 미발화), 실제 사람 정보가 채워지는 UPDATE 전환이 진짜 "신규가입" 시그널이다.
--
-- 멱등성/오발화 안전:
--   · 껍데기 생성은 INSERT → 이 AFTER UPDATE 트리거 미발화.
--   · NULL→set 단방향 전환은 가입 때 한 번뿐.
--   · edit 모드 updateProfile 은 3필드가 이미 non-null → 전환 조건 불충족 → 미발화.
--   · 운영진의 실력 편집(updateMemberSkills)은 skills 만 UPDATE → 3필드 불변 → 미발화.
--   · is_guest 게스트(RSVP 게스트)는 제외.
--   · 가입자 본인이 운영진이어도 자기 자신은 제외.

create or replace function public.notify_admins_new_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if (old.gender is null or old.birth_year is null or old.residence is null)
		and new.gender is not null
		and new.birth_year is not null
		and new.residence is not null
		and coalesce(new.is_guest, false) = false
	then
		insert into public.notifications (recipient_member_id, type, session_id, payload)
		select ur.member_id, 'new_member', null,
			jsonb_build_object('name', new.name, 'member_id', new.id)
		from public.user_roles ur
		where ur.role = 'admin'
			and ur.member_id is distinct from new.id;
	end if;
	return new;
end;
$$;

drop trigger if exists trg_notify_admins_new_member on public.members;
create trigger trg_notify_admins_new_member
	after update on public.members
	for each row execute function public.notify_admins_new_member();

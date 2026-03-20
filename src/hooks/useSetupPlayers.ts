import { disassemble, getChoseong } from "es-hangul";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GenderFilter } from "../components/setup/PlayerSelectionList";
import { useAppStore } from "../store/appStore";
import { useSessionStore } from "../store/sessionStore";
import type { Player } from "../types";

/**
 * SessionSetup에서 플레이어 목록 파생, 필터링, 선택 관리를 담당하는 훅
 */
export function useSetupPlayers(guests: Player[]) {
	const allStorePlayers = useAppStore((s) => s.allPlayers);
	const sessionMeta = useAppStore((s) => s.sessionMeta);

	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);

	const isUpdating = !!sessionMeta;

	// 플레이어 목록 파생
	const players = useMemo(() => {
		if (allStorePlayers.length > 0) return allStorePlayers;
		if (!sessionMeta) return [];
		const guestIdSet = new Set(guests.map((g) => g.id));
		const playerMap = new Map<string, Player>();

		// sessionPlayers Map이 전체 참가자의 단일 소스
		for (const sp of sessionPlayers.values()) {
			if (!playerMap.has(sp.playerId) && !guestIdSet.has(sp.playerId)) {
				playerMap.set(sp.playerId, {
					id: sp.playerId,
					name: sp.name,
					gender: sp.gender,
					skills: sp.skills,
				});
			}
		}
		return Array.from(playerMap.values());
	}, [
		allStorePlayers,
		sessionMeta,
		guests,
		sessionPlayers,
	]);

	// 제거 불가능한 플레이어 (현재 경기 중)
	const nonRemovablePlayerIds = useMemo(() => {
		if (!sessionMeta) return new Set<string>();
		const ids = new Set<string>();
		for (const p of sessionPlayers.values()) {
			if (p.status === "playing") ids.add(p.playerId);
		}
		return ids;
	}, [sessionMeta, sessionPlayers]);

	// 선택 상태
	const [isSetupInitialized, setIsSetupInitialized] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [search, setSearch] = useState("");
	const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");

	// 초기 선택 설정 (최초 1회만)
	useEffect(() => {
		if (!isSetupInitialized && players.length > 0) {
			if (sessionMeta) {
				// sessionPlayers Map이 단일 소스 — 전체 참가자의 playerId를 선택 상태로 설정
				const sessionPlayerIds = new Set(
					[...sessionPlayers.values()].map((p) => p.playerId),
				);
				setSelected(sessionPlayerIds);
			} else {
				setSelected(new Set());
			}
			setIsSetupInitialized(true);
		}
	}, [isSetupInitialized, players, sessionMeta, sessionPlayers]);

	const allPlayers = useMemo(() => [...players, ...guests], [players, guests]);

	// selected Set을 allPlayers에 존재하는 ID로만 정리
	useEffect(() => {
		if (allPlayers.length === 0) return;
		const validIds = new Set(allPlayers.map((p) => p.id));
		setSelected((prev) => {
			const filtered = new Set([...prev].filter((id) => validIds.has(id)));
			if (filtered.size === prev.size) return prev;
			return filtered;
		});
	}, [allPlayers.length]);

	// 검색
	const matchesSearch = useCallback(
		(name: string) => {
			if (!search) return true;
			if (name.includes(search)) return true;
			const decomposed = disassemble(search);
			const isAllChoseong = /^[ㄱ-ㅎ]+$/.test(decomposed);
			if (isAllChoseong) {
				return getChoseong(name).includes(decomposed);
			}
			return false;
		},
		[search],
	);

	const filtered = useMemo(() => {
		return players.filter((p) => {
			const matchName = matchesSearch(p.name);
			const matchGender = genderFilter === "all" || genderFilter === "selected" || p.gender === genderFilter;
			const matchSelected = genderFilter !== "selected" || selected.has(p.id);
			return matchName && matchGender && matchSelected;
		});
	}, [players, matchesSearch, genderFilter, selected]);

	const filteredGuests = useMemo(() => {
		return guests.filter((p) => {
			const matchName = matchesSearch(p.name);
			const matchGender = genderFilter === "all" || genderFilter === "selected" || p.gender === genderFilter;
			const matchSelected = genderFilter !== "selected" || selected.has(p.id);
			return matchName && matchGender && matchSelected;
		});
	}, [guests, matchesSearch, genderFilter, selected]);

	const selectedCount = allPlayers.filter((p) => selected.has(p.id)).length;

	// 토글
	function togglePlayer(id: string) {
		if (nonRemovablePlayerIds?.has(id)) return;
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleAll() {
		const allFilteredPlayers = [...filtered, ...filteredGuests];
		setSelected((prev) => {
			const hasAnySelected = prev.size > 0;
			if (hasAnySelected) {
				const next = new Set<string>();
				allPlayers.forEach((p) => {
					if (nonRemovablePlayerIds?.has(p.id)) {
						next.add(p.id);
					}
				});
				return next;
			}
			const next = new Set(prev);
			allFilteredPlayers.forEach((p) => next.add(p.id));
			return next;
		});
	}

	return {
		allPlayers,
		isUpdating,
		nonRemovablePlayerIds,
		selected,
		setSelected,
		search,
		setSearch,
		genderFilter,
		setGenderFilter,
		filtered,
		filteredGuests,
		selectedCount,
		togglePlayer,
		toggleAll,
		sessionMeta,
	};
}

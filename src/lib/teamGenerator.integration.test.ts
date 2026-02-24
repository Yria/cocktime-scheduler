import { describe, expect, it } from "vitest";
import type { SessionPlayer } from "../types";
import { fetchPlayers } from "./sheetsApi";
import { generateTeam, skillScore } from "./teamGenerator";

describe("실제 구글 시트 데이터 기반 팀 생성 통합 테스트", () => {
	it("시트에서 선수를 가져와서 팀을 정상적으로 생성한다", async () => {

		console.log("\n▶ 실제 시트 데이터 연동 테스트 시작");

		// 1. 시트에서 실제 선수 데이터 가져오기
		const players = await fetchPlayers();
		expect(players.length).toBeGreaterThan(0);
		console.log(`  ✅ 총 ${players.length}명의 선수를 시트에서 불러왔습니다.`);

		// 2. Player 타입을 SessionPlayer 타입으로 변환 (초기 대기열 상태)
		const waitingPlayers: SessionPlayer[] = players.map((p) => ({
			...p,
			playerId: p.id,
			status: "waiting",
			gameCount: 0,
			mixedCount: 0,
			forceMixed: false,
			forceHardGame: false,
			allowMixedSingle: false,
			waitSince: new Date().toISOString(),
		}));

		// 3. 테스트를 위해 특정 이름의 선수들만 추출
		const targetNames = [
			"정원준", "오상진", "전준형", "홍예린", "황준기", 
			"우창형", "김재완", "김선예", "임동환", "김명재", 
			"백준우", "진명현", "최양회", "심상욱", "양지현", 
			"권진희", "손형일", "송유현"
		];
		
		const testGroup = waitingPlayers.filter((p) => targetNames.includes(p.name));
		
		console.log(
			`  ✅ 테스트 대상 ${testGroup.length}명: ${testGroup.map((p) => `${p.name}(${p.gender}, ${skillScore(p).toFixed(1)})`).join(", ")}`,
		);

		// 4. 코트 3개에 계속 팀을 뽑아서 출력 (비동기 종료 시뮬레이션)
		const COURT_COUNT = 3;
		const TARGET_MATCHES = 15; // 총 15경기 시뮬레이션 (기존 5라운드 * 3코트 분량)
		const history: Record<string, Set<string>> = {};
		let lastMixedPlayerIds: string[] = [];

		let currentWaiting = [...testGroup];
		const courts: (ReturnType<typeof generateTeam> | null)[] = Array(COURT_COUNT).fill(null);
		let totalMatchesPlayed = 0;
		let cycle = 1;

		while (totalMatchesPlayed < TARGET_MATCHES) {
			console.log(`\n==================================================`);
			console.log(`  [사이클 ${cycle}] 매칭 시도 및 경기 종료`);
			console.log(`==================================================`);

			// 1. 빈 코트에 새로운 매칭 배정
			for (let i = 0; i < COURT_COUNT; i++) {
				if (courts[i] === null) {
					// 대기열 정렬 (gameCount 오름차순)
					currentWaiting.sort((a, b) => a.gameCount - b.gameCount);

					if (currentWaiting.length < 4) {
						console.log(`  [코트 ${i + 1}] 대기 인원 부족 (${currentWaiting.length}명) - 배정 대기`);
						continue;
					}

					const team = generateTeam(currentWaiting, history, [], lastMixedPlayerIds);
					
					if (!team) {
						console.log(`  [코트 ${i + 1}] 팀 생성 실패 (조건 불충족) - 배정 대기`);
						continue;
					}

					courts[i] = team;

					// 매칭된 선수들을 대기열에서 제거
					const selectedIds = [...team.teamA, ...team.teamB].map(p => p.id);
					currentWaiting = currentWaiting.filter(p => !selectedIds.includes(p.id));

					console.log(`  ▶ [코트 ${i + 1} IN] 게임 타입: ${team.gameType}`);
					console.log(`    팀 A: ${team.teamA.map((p) => `${p.name}(${p.gender}, ${skillScore(p).toFixed(1)})`).join(" + ")}`);
					console.log(`    팀 B: ${team.teamB.map((p) => `${p.name}(${p.gender}, ${skillScore(p).toFixed(1)})`).join(" + ")}`);
				}
			}

			// 2. 진행 중인 코트 중 랜덤하게 1~3개 종료
			const playingCourts = courts.map((c, index) => ({ c, index })).filter(x => x.c !== null);
			if (playingCourts.length === 0) {
				console.log("  진행 중인 경기가 없어 시뮬레이션을 종료합니다.");
				break;
			}

			// 종료할 코트 개수 랜덤 결정 (1개 ~ 현재 돌아가고 있는 코트 수)
			const finishCount = Math.floor(Math.random() * playingCourts.length) + 1;
			
			// 배열 섞어서 종료할 코트 선택
			const shuffled = playingCourts.sort(() => 0.5 - Math.random());
			const finishingCourts = shuffled.slice(0, finishCount);

			const nextMixedPlayerIds: string[] = [];

			console.log(`\n  -- ${finishCount}개 코트 경기 종료 --`);
			for (const { c: match, index } of finishingCourts) {
				if (!match) continue;
				
				console.log(`  ◀ [코트 ${index + 1} OUT] ${match.gameType} 종료`);
				
				const players = [...match.teamA, ...match.teamB];
				
				// 1. 경기 수 증가 및 대기열 복귀
				for (const p of players) {
					const playerInGroup = testGroup.find(tp => tp.id === p.id);
					if (playerInGroup) {
						playerInGroup.gameCount += 1;
						if (match.gameType === "혼복") {
							playerInGroup.mixedCount += 1;
						}
						// 대기열로 복귀
						currentWaiting.push(playerInGroup);
					}
				}

				// 2. 파트너 이력 업데이트
				for (const [a, b] of [match.teamA, match.teamB]) {
					if (!history[a.id]) history[a.id] = new Set();
					if (!history[b.id]) history[b.id] = new Set();
					history[a.id].add(b.id);
					history[b.id].add(a.id);
				}

				// 3. 직전 혼복 출전자 기록
				if (match.gameType === "혼복") {
					nextMixedPlayerIds.push(...players.map(p => p.id));
				}

				// 코트 비우기
				courts[index] = null;
				totalMatchesPlayed++;

				if (totalMatchesPlayed >= TARGET_MATCHES) {
					break;
				}
			}

			// 직전 혼복 출전자 업데이트 (이번 사이클에 끝난 혼복 참여자들)
			if (nextMixedPlayerIds.length > 0) {
				lastMixedPlayerIds = nextMixedPlayerIds;
			} else {
				lastMixedPlayerIds = [];
			}

			cycle++;
		}

		// 모든 라운드 종료 후 선수 상태 요약
		console.log(`\n==================================================`);
		console.log(`  [모든 라운드 종료 후 최종 선수 상태 요약]`);
		console.log(`==================================================`);
		const sortedByGameCount = [...testGroup].sort((a, b) => a.gameCount - b.gameCount);
		
		// 경기 수 통계
		const gameCounts = sortedByGameCount.map(p => p.gameCount);
		const minGameCount = Math.min(...gameCounts);
		const maxGameCount = Math.max(...gameCounts);
		
		// 혼복 수 통계 (남녀 모두)
		const mixedCounts = sortedByGameCount.map(p => p.mixedCount);
		const minMixedCount = Math.min(...mixedCounts);
		const maxMixedCount = Math.max(...mixedCounts);

		console.log(
			`    ${sortedByGameCount.map(p => {
				let flags = "";
				if (p.gameCount === maxGameCount && maxGameCount > minGameCount) flags += " 🔺경기많음";
				if (p.gameCount === minGameCount && maxGameCount > minGameCount) flags += " 🔻경기적음";
				
				// 남녀 모두 혼복 통계 표시
				if (p.mixedCount === maxMixedCount && maxMixedCount > minMixedCount) flags += " 🔺혼복많음";
				if (p.mixedCount === minMixedCount && maxMixedCount > minMixedCount) flags += " 🔻혼복적음";
				
				return `${p.name}(경기:${p.gameCount}, 혼복:${p.mixedCount}${flags})`;
			}).join("\n    ")}`
		);
	});
});

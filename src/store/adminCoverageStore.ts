import { create } from "zustand";
import { supabase } from "../lib/supabase/client";

export interface CoveragePrompt {
	key: string;
	names: string;
	alternative?: { key: string; label: string };
	start: () => void;
}
interface AdminCoverageState {
	memberIds: ReadonlySet<string>;
	loaded: boolean;
	starting: ReadonlyMap<string, readonly string[]>;
	prompt: CoveragePrompt | null;
	refresh: () => Promise<boolean>;
}
let refreshing: Promise<boolean> | null = null;
export const useAdminCoverageStore = create<AdminCoverageState>((set) => ({
	memberIds: new Set(), loaded: false, starting: new Map(), prompt: null,
	refresh: () => {
		if (refreshing) return refreshing;
		refreshing = (async () => {
			try {
				const { data, error } = await supabase.from("members").select("id, user_roles!inner(role)")
					.eq("is_active", true).eq("user_roles.role", "admin");
				if (error) return false;
				set({ memberIds: new Set((data ?? []).map(row => row.id)), loaded: true });
				return true;
			} catch { return false; }
			finally { refreshing = null; }
		})();
		return refreshing;
	},
}));

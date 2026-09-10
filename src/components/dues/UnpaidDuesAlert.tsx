import { useAuthStore } from "../../store/authStore";
import { useDuesMode } from "../../store/duesStore";
import { AccountingEntryAlert } from "../accounting/AccountingMember";

export default function UnpaidDuesAlert() {
	const { mode, error } = useDuesMode();
	const member = useAuthStore((s) => s.memberId);
	if (!mode?.enabled || error || !member) return null;
	return <AccountingEntryAlert key={member} />;
}

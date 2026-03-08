import { useSessionStore } from "./sessionStore";

export const setShowEndConfirm = (show: boolean) =>
	useSessionStore.setState({ showEndConfirm: show });

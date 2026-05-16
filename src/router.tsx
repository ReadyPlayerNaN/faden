import {
	createRouter,
	createRoute,
	createRootRoute,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { ProjectPicker } from "./views/ProjectPicker/ProjectPicker";
import { Workspace } from "./views/Workspace/Workspace";
import { Settings } from "./views/Settings/Settings";
import { TagsView } from "./views/Tags/TagsView";
import { PeopleView } from "./views/People/PeopleView";
import { AiOpsView } from "./views/AI/AiOpsView";
import { AiOpDetailView } from "./views/AI/AiOpDetailView";
import { SuggestionsView } from "./views/AI/SuggestionsView";
import { AudioPlayer } from "./views/Workspace/AudioPlayer/AudioPlayer";
import { currentProjectAtom } from "./state/project";

const isProjectRoute = (pathname: string) =>
	pathname === "/tags" ||
	pathname === "/people" ||
	pathname.startsWith("/workspace/") ||
	(pathname.startsWith("/settings/") && pathname !== "/settings");

const RootLayout = () => {
	const location = useLocation();
	const project = useAtomValue(currentProjectAtom);
	const showProjectStatusBar = Boolean(project) && isProjectRoute(location.pathname);
	const showAudioControls = location.pathname.startsWith("/workspace/");

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
				<Outlet />
			</div>
			{showProjectStatusBar ? <AudioPlayer showAudioControls={showAudioControls} /> : null}
		</div>
	);
};

const rootRoute = createRootRoute({
	component: RootLayout,
});

const pickerRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: ProjectPicker,
});

const workspaceRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/workspace/$projectPath",
	component: Workspace,
});

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: Settings,
});

const settingsProjectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings/$projectPath",
	component: Settings,
});

const aiOpsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/workspace/$projectPath/ai-ops",
	component: AiOpsView,
});

const aiOpDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/workspace/$projectPath/ai-ops/$runId",
	component: AiOpDetailView,
});

const suggestionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/workspace/$projectPath/suggestions",
	component: SuggestionsView,
});

const tagsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/tags",
	component: TagsView,
});

const peopleRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/people",
	component: PeopleView,
});

const peopleProjectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/workspace/$projectPath/people",
	component: PeopleView,
});

const routeTree = rootRoute.addChildren([
	pickerRoute,
	workspaceRoute,
	settingsRoute,
	settingsProjectRoute,
	aiOpsRoute,
	aiOpDetailRoute,
	suggestionsRoute,
	tagsRoute,
	peopleRoute,
	peopleProjectRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

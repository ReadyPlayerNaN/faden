import {
  createRouter,
  createRoute,
  createRootRoute,
  Outlet,
} from "@tanstack/react-router";
import { ProjectPicker } from "./views/ProjectPicker/ProjectPicker";
import { Workspace } from "./views/Workspace/Workspace";
import { Settings } from "./views/Settings/Settings";
import { TagsView } from "./views/Tags/TagsView";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
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

const tagsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tags",
  component: TagsView,
});

const routeTree = rootRoute.addChildren([
  pickerRoute,
  workspaceRoute,
  settingsRoute,
  tagsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Screen } from "../shared/navigation";
import { readRoute, routes } from "./routes";
type NavigationState = {
  screen: Screen;
  setScreen: Dispatch<SetStateAction<Screen>>;
  authMode: "login" | "register";
  setAuthMode: Dispatch<SetStateAction<"login" | "register">>;
  route: (next: Screen) => void;
};
export function useNavigation(): NavigationState {
  const [screen, setScreen] = useState<Screen>(() =>
    readRoute(window.location.pathname),
  );
  const [authMode, setAuthMode] = useState<"login" | "register">(
    window.location.pathname === "/register" ? "register" : "login",
  );
  const route = useCallback((next: Screen): void => {
    if (next === "auth") setAuthMode("login");
    window.history.pushState(null, "", routes[next]);
    setScreen(next);
  }, []);
  useEffect(() => {
    if (window.location.pathname === "/welcome")
      window.history.replaceState(null, "", "/");
    const pop = (): void => {
      setScreen(readRoute(window.location.pathname));
      setAuthMode(
        window.location.pathname === "/register" ? "register" : "login",
      );
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  return { screen, setScreen, authMode, setAuthMode, route };
}

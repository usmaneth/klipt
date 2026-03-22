import { useEffect, useState } from "react";
import { CountdownOverlay } from "./components/countdown/CountdownOverlay";
import { HomeScreen } from "./components/home/HomeScreen";
import CameraBubble from "./components/launch/CameraBubble";
import { LaunchWindow } from "./components/launch/LaunchWindow";
import { SourceSelector } from "./components/launch/SourceSelector";
import { ShortcutsConfigDialog } from "./components/video-editor/ShortcutsConfigDialog";
import VideoEditor from "./components/video-editor/VideoEditor";
import { useI18n } from "./contexts/I18nContext";
import { ShortcutsProvider } from "./contexts/ShortcutsContext";
import { loadAllCustomFonts } from "./lib/customFonts";

export default function App() {
	const [windowType, setWindowType] = useState("");
	const { locale, t } = useI18n();

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const type = params.get("windowType") || "";
		setWindowType(type);

		if (
			type === "hud-overlay" ||
			type === "source-selector" ||
			type === "countdown" ||
			type === "camera-bubble"
		) {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		} else {
			// Ensure dark background for editor/home windows immediately
			document.body.style.background = "#0A0A0F";
			document.documentElement.style.background = "#0A0A0F";
		}

		loadAllCustomFonts().catch((error) => {
			console.error("Failed to load custom fonts:", error);
		});
	}, []);

	useEffect(() => {
		document.title =
			windowType === "editor" ? t("app.editorTitle", "klipt editor") : t("app.name", "klipt");
	}, [windowType, locale, t]);

	switch (windowType) {
		case "hud-overlay":
			return <LaunchWindow />;
		case "source-selector":
			return <SourceSelector />;
		case "countdown":
			return <CountdownOverlay />;
		case "camera-bubble":
			return <CameraBubble />;
		case "editor":
			return (
				<ShortcutsProvider>
					<VideoEditor />
					<ShortcutsConfigDialog />
				</ShortcutsProvider>
			);
		case "home":
			return <HomeScreen />;
		default:
			return <HomeScreen />;
	}
}

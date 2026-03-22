import { useEffect, useState } from "react";

export interface WebcamDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

export function useWebcamDevices(enabled: boolean = true) {
	const [devices, setDevices] = useState<WebcamDevice[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] = useState<string>("default");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		let mounted = true;

		const loadDevices = async () => {
			try {
				setIsLoading(true);
				setError(null);

				const stream = await navigator.mediaDevices.getUserMedia({ video: true });
				const allDevices = await navigator.mediaDevices.enumerateDevices();
				const videoInputs = allDevices
					.filter((device) => device.kind === "videoinput")
					.map((device) => ({
						deviceId: device.deviceId,
						label: device.label || `Camera ${device.deviceId.slice(0, 8)}`,
						groupId: device.groupId,
					}));

				stream.getTracks().forEach((track) => track.stop());

				if (mounted) {
					setDevices(videoInputs);
					if (selectedDeviceId === "default" && videoInputs.length > 0) {
						setSelectedDeviceId(videoInputs[0].deviceId);
					}
					setIsLoading(false);
				}
			} catch (error) {
				if (mounted) {
					const message =
						error instanceof Error ? error.message : "Failed to enumerate video devices";
					setError(message);
					setIsLoading(false);
					console.error("Error loading webcam devices:", error);
				}
			}
		};

		void loadDevices();

		const handleDeviceChange = () => {
			void loadDevices();
		};

		navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

		return () => {
			mounted = false;
			navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
		};
	}, [enabled, selectedDeviceId]);

	return {
		devices,
		selectedDeviceId,
		setSelectedDeviceId,
		isLoading,
		error,
	};
}

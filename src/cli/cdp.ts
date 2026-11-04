/**
 * A small Chrome DevTools Protocol client on the WebSocket of Node (Node 22 or later).
 * It talks to one page target, directly or through a flat session of a browser connection.
 */

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };
type Listener = (params: Record<string, unknown>) => void;

export class CdpSession {
	private ws: WebSocket;
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private listeners = new Map<string, Listener[]>();
	private sessionId: string | undefined;
	closed = false;
	onClose: (() => void) | undefined;

	private constructor(ws: WebSocket) {
		this.ws = ws;
		ws.addEventListener("message", (event) => this.onMessage(String(event.data)));
		ws.addEventListener("close", () => {
			this.closed = true;
			for (const p of this.pending.values()) p.reject(new Error("the DevTools connection closed"));
			this.pending.clear();
			this.onClose?.();
		});
	}

	static open(url: string, timeoutMs = 10000): Promise<CdpSession> {
		return new Promise((resolve, reject) => {
			let ws: WebSocket;
			try {
				ws = new WebSocket(url);
			} catch (error) {
				reject(
					new Error(
						`cannot open ${url}: ${error instanceof Error ? error.message : String(error)}`,
					),
				);
				return;
			}
			const timer = setTimeout(() => {
				ws.close();
				reject(new Error(`no answer from ${url} in ${timeoutMs / 1000}s`));
			}, timeoutMs);
			ws.addEventListener("open", () => {
				clearTimeout(timer);
				resolve(new CdpSession(ws));
			});
			ws.addEventListener("error", () => {
				clearTimeout(timer);
				reject(new Error(`cannot connect to ${url}`));
			});
		});
	}

	/** Attach to a page through a browser connection. Commands then go to that page. */
	async attach(targetId: string): Promise<void> {
		const r = await this.send("Target.attachToTarget", { targetId, flatten: true });
		this.sessionId = String(r.sessionId);
	}

	send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
		if (this.closed) return Promise.reject(new Error("the DevTools connection is closed"));
		const id = this.nextId++;
		const message: Record<string, unknown> = { id, method, params };
		if (this.sessionId && !method.startsWith("Target.")) message.sessionId = this.sessionId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify(message));
		});
	}

	on(method: string, listener: Listener): void {
		const list = this.listeners.get(method) ?? [];
		list.push(listener);
		this.listeners.set(method, list);
	}

	close(): void {
		if (!this.closed) this.ws.close();
	}

	private onMessage(text: string): void {
		let msg: {
			id?: number;
			method?: string;
			params?: Record<string, unknown>;
			result?: Record<string, unknown>;
			error?: { message?: string };
			sessionId?: string;
		};
		try {
			msg = JSON.parse(text);
		} catch {
			return;
		}
		if (msg.id !== undefined) {
			const p = this.pending.get(msg.id);
			if (!p) return;
			this.pending.delete(msg.id);
			if (msg.error) p.reject(new Error(msg.error.message ?? "DevTools error"));
			else p.resolve(msg.result ?? {});
			return;
		}
		if (!msg.method) return;
		if (this.sessionId && msg.sessionId !== this.sessionId) return;
		for (const l of this.listeners.get(msg.method) ?? []) l(msg.params ?? {});
	}
}

export type PageTarget = { id: string; url: string; title: string; webSocketDebuggerUrl: string };

/** The http endpoint of a DevTools port: http://host:port. Accept "9222", "host:9222" and "http://host:9222/...". */
export function devtoolsHttpBase(spec: string): string | undefined {
	if (/^\d+$/.test(spec)) return `http://127.0.0.1:${spec}`;
	if (/^[\w.-]+:\d+$/.test(spec)) return `http://${spec}`;
	const m = /^(https?:\/\/[^/]+)/.exec(spec);
	return m ? m[1] : undefined;
}

export async function listPages(
	base: string,
	fetchImpl: typeof fetch = fetch,
): Promise<PageTarget[]> {
	let res: Response;
	try {
		res = await fetchImpl(`${base}/json/list`, { signal: AbortSignal.timeout(5000) });
	} catch (error) {
		const cause =
			error instanceof Error && "cause" in error && error.cause instanceof Error
				? error.cause.message
				: "";
		throw new Error(`no DevTools at ${base}${cause ? `: ${cause}` : ""}`);
	}
	if (!res.ok) throw new Error(`${base}/json/list answered HTTP ${res.status}`);
	const data = (await res.json()) as unknown;
	if (!Array.isArray(data)) throw new Error(`${base}/json/list is not a list`);
	return data
		.filter(
			(t): t is Record<string, unknown> => typeof t === "object" && t !== null && t.type === "page",
		)
		.map((t) => ({
			id: String(t.id),
			url: String(t.url ?? ""),
			title: String(t.title ?? ""),
			webSocketDebuggerUrl: String(t.webSocketDebuggerUrl ?? ""),
		}));
}

/** True when base is a DevTools endpoint (it answers /json/version). */
export async function isDevtools(base: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
	try {
		const res = await fetchImpl(`${base}/json/version`, { signal: AbortSignal.timeout(2000) });
		if (!res.ok) return false;
		const data = (await res.json()) as Record<string, unknown>;
		return typeof data.webSocketDebuggerUrl === "string" || typeof data.Browser === "string";
	} catch {
		return false;
	}
}

/** Pick the page: the first one whose URL or title contains match, else the first normal page. */
export function pickPage(pages: PageTarget[], match?: string): PageTarget | undefined {
	if (match) {
		const m = match.toLowerCase();
		return pages.find((p) => p.url.toLowerCase().includes(m) || p.title.toLowerCase().includes(m));
	}
	return (
		pages.find(
			(p) => !p.url.startsWith("devtools://") && !p.url.startsWith("chrome-extension://"),
		) ?? pages[0]
	);
}

/** Width and height of a JPEG from its SOF segment. */
export function jpegSize(buf: Buffer): { width: number; height: number } | undefined {
	if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
	let i = 2;
	while (i + 9 < buf.length) {
		if (buf[i] !== 0xff) {
			i++;
			continue;
		}
		const marker = buf[i + 1];
		if (marker === 0xff) {
			i++;
			continue;
		}
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
		}
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			i += 2;
			continue;
		}
		i += 2 + buf.readUInt16BE(i + 2);
	}
	return undefined;
}

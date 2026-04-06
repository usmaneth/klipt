import type { Chapter } from "@/components/video-editor/types";

// ── Data Model ──────────────────────────────────────────────────────────────

export interface Workspace {
	id: string;
	name: string;
	icon: string; // emoji
	createdAt: number;
}

export interface Project {
	id: string;
	workspaceId: string;
	name: string;
	color: string; // hex
	createdAt: number;
}

export interface RecordingEntry {
	id: string;
	projectId: string | null;
	title: string;
	filePath: string;
	thumbnailPath?: string;
	durationMs: number;
	createdAt: number;
	tags: string[];
	chapters?: Chapter[];
}

interface WorkspaceData {
	workspaces: Workspace[];
	projects: Project[];
	recordings: RecordingEntry[];
}

// ── Manager ─────────────────────────────────────────────────────────────────

const DEFAULT_DATA: WorkspaceData = { workspaces: [], projects: [], recordings: [] };

let cached: WorkspaceData | null = null;

function uid(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// These will be set by the IPC init
let readFile: (p: string) => Promise<string>;
let writeFile: (p: string, d: string) => Promise<void>;
let mkdirp: (p: string) => Promise<void>;
let dataPath: string;

export function initWorkspaceManager(fns: {
	readFile: (p: string) => Promise<string>;
	writeFile: (p: string, d: string) => Promise<void>;
	mkdir: (p: string) => Promise<void>;
	dataDir: string;
}) {
	readFile = fns.readFile;
	writeFile = fns.writeFile;
	mkdirp = fns.mkdir;
	dataPath = `${fns.dataDir}/workspaces.json`;
}

async function load(): Promise<WorkspaceData> {
	if (cached) return cached;
	try {
		const raw = await readFile(dataPath);
		cached = JSON.parse(raw) as WorkspaceData;
	} catch {
		cached = { ...DEFAULT_DATA };
	}
	return cached;
}

async function save(data: WorkspaceData): Promise<void> {
	cached = data;
	await mkdirp(dataPath.replace(/\/[^/]+$/, ""));
	await writeFile(dataPath, JSON.stringify(data, null, 2));
}

// ── Workspace CRUD ──────────────────────────────────────────────────────────

export async function listWorkspaces(): Promise<Workspace[]> {
	return (await load()).workspaces;
}

export async function createWorkspace(name: string, icon = "📁"): Promise<Workspace> {
	const data = await load();
	const ws: Workspace = { id: uid(), name, icon, createdAt: Date.now() };
	data.workspaces.push(ws);
	await save(data);
	return ws;
}

export async function deleteWorkspace(id: string): Promise<void> {
	const data = await load();
	data.workspaces = data.workspaces.filter((w) => w.id !== id);
	// Remove projects in this workspace
	const projectIds = new Set(data.projects.filter((p) => p.workspaceId === id).map((p) => p.id));
	data.projects = data.projects.filter((p) => p.workspaceId !== id);
	// Unassign recordings from deleted projects
	for (const rec of data.recordings) {
		if (rec.projectId && projectIds.has(rec.projectId)) {
			rec.projectId = null;
		}
	}
	await save(data);
}

// ── Project CRUD ────────────────────────────────────────────────────────────

export async function listProjects(workspaceId?: string): Promise<Project[]> {
	const data = await load();
	if (workspaceId) return data.projects.filter((p) => p.workspaceId === workspaceId);
	return data.projects;
}

export async function createProject(workspaceId: string, name: string, color = "#E0000F"): Promise<Project> {
	const data = await load();
	const proj: Project = { id: uid(), workspaceId, name, color, createdAt: Date.now() };
	data.projects.push(proj);
	await save(data);
	return proj;
}

export async function deleteProject(id: string): Promise<void> {
	const data = await load();
	data.projects = data.projects.filter((p) => p.id !== id);
	for (const rec of data.recordings) {
		if (rec.projectId === id) rec.projectId = null;
	}
	await save(data);
}

// ── Recording CRUD ──────────────────────────────────────────────────────────

export async function listRecordings(projectId?: string | null): Promise<RecordingEntry[]> {
	const data = await load();
	if (projectId !== undefined) {
		return data.recordings.filter((r) => r.projectId === projectId);
	}
	return data.recordings;
}

export async function addRecording(entry: Omit<RecordingEntry, "id" | "createdAt">): Promise<RecordingEntry> {
	const data = await load();
	const rec: RecordingEntry = { ...entry, id: uid(), createdAt: Date.now() };
	data.recordings.push(rec);
	await save(data);
	return rec;
}

export async function removeRecording(id: string): Promise<void> {
	const data = await load();
	data.recordings = data.recordings.filter((r) => r.id !== id);
	await save(data);
}

export async function moveRecording(id: string, projectId: string | null): Promise<void> {
	const data = await load();
	const rec = data.recordings.find((r) => r.id === id);
	if (rec) {
		rec.projectId = projectId;
		await save(data);
	}
}

export async function searchRecordings(query: string): Promise<RecordingEntry[]> {
	const data = await load();
	const q = query.toLowerCase();
	return data.recordings.filter(
		(r) => r.title.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)),
	);
}

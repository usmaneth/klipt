/**
 * A strict flag parser for the klipt CLI.
 * An unknown flag is an error: the CLI never ignores a typo.
 */

export class UsageError extends Error {}

export type FlagKind = "string" | "number" | "boolean" | "list";

export type FlagSpec = Record<string, FlagKind>;

export type ParsedFlags = {
	values: Record<string, string | number | boolean | string[]>;
	positionals: string[];
};

export function parseFlags(argv: string[], spec: FlagSpec): ParsedFlags {
	const values: ParsedFlags["values"] = {};
	const positionals: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) {
			positionals.push(arg);
			continue;
		}
		const eq = arg.indexOf("=");
		const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
		const kind = spec[name];
		if (!kind) {
			throw new UsageError(`unknown option --${name}`);
		}
		if (kind === "boolean") {
			if (eq !== -1) {
				throw new UsageError(`--${name} takes no value`);
			}
			values[name] = true;
			continue;
		}
		let raw: string;
		if (eq !== -1) {
			raw = arg.slice(eq + 1);
		} else {
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("--")) {
				throw new UsageError(`--${name} needs a value`);
			}
			raw = next;
			i++;
		}
		if (kind === "number") {
			const n = Number(raw);
			if (raw.trim() === "" || !Number.isFinite(n)) {
				throw new UsageError(`--${name} must be a number, got "${raw}"`);
			}
			values[name] = n;
		} else if (kind === "list") {
			const list = (values[name] as string[] | undefined) ?? [];
			list.push(raw);
			values[name] = list;
		} else {
			values[name] = raw;
		}
	}
	return { values, positionals };
}

export function str(flags: ParsedFlags, name: string): string | undefined {
	const v = flags.values[name];
	return typeof v === "string" ? v : undefined;
}

export function num(flags: ParsedFlags, name: string): number | undefined {
	const v = flags.values[name];
	return typeof v === "number" ? v : undefined;
}

export function bool(flags: ParsedFlags, name: string): boolean {
	return flags.values[name] === true;
}

export function requireStr(flags: ParsedFlags, name: string): string {
	const v = str(flags, name);
	if (!v) {
		throw new UsageError(`--${name} is required`);
	}
	return v;
}

import type { DataAdapter } from "obsidian";

export interface HistoryStat { mtime: number; size: number; }

// Node modules are loaded only for an explicitly configured desktop directory.
// The original vault storage remains usable on mobile.
export class HistoryStorage {
    private fs: typeof import("fs/promises");
    private path: typeof import("path");
    readonly directory: string;

    constructor(private adapter: DataAdapter, directory = "", vaultPath = "") {
        if (!directory) { this.directory = ""; return; }
        this.fs = require("fs/promises");
        this.path = require("path");
        const crypto: typeof import("crypto") = require("crypto");
        directory = directory.trim().replace(/^"(.*)"$/, "$1");
        if (!this.path.isAbsolute(directory) || (process.platform === "win32" &&
            !/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(directory))) {
            throw new Error("Enter a full directory path, such as D:\\Obsidian Backups, or a UNC network path.");
        }
        if (!vaultPath) throw new Error("External backup directories require a desktop filesystem vault.");
        const base = this.path.resolve(vaultPath);
        const root = this.path.resolve(directory);
        this.assertOutsideVault(root, base);
        const name = this.path.basename(base).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "").slice(0, 80) || "vault";
        const identity = process.platform === "win32" ? base.toLowerCase() : base;
        const id = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 12);
        this.directory = this.path.join(root, `${name}-${id}`);
    }

    private assertOutsideVault(directory: string, vault: string) {
        const relative = this.path.relative(vault, directory);
        if (!relative || (!relative.startsWith(".." + this.path.sep) && relative !== ".." && !this.path.isAbsolute(relative))) {
            throw new Error("Choose a backup directory outside the vault.");
        }
    }

    private location(relative: string): string {
        // History paths always come from vault-relative note paths.
        const parts = relative.replace(/\\/g, "/").split("/");
        if (!relative || parts.some(part => part === ".." || part === "." || part.includes(":")) || relative.startsWith("/")) {
            throw new Error("Invalid history path.");
        }
        // A legal 255-character note name may exceed NTFS's component limit once .edtz is added.
        const leaf = parts[parts.length - 1];
        if (leaf.length > 255 && leaf.endsWith('.edtz')) parts[parts.length - 1] =
            Array.from(leaf.slice(0,-5)).slice(0,80).join('') + '~' + require('crypto').createHash('sha256').update(leaf).digest('hex').slice(0,24) + '.edtz';
        return this.path.join(this.directory, ...parts);
    }

    async validate(vaultPath: string): Promise<void> {
        if (!this.directory) return;
        await this.fs.mkdir(this.directory, { recursive: true });
        this.assertOutsideVault(await this.fs.realpath(this.directory), await this.fs.realpath(vaultPath));
        const probe = this.path.join(this.directory, `.write-test-${require("crypto").randomBytes(8).toString("hex")}`);
        await this.fs.writeFile(probe, "", { flag: "wx" });
        await this.fs.unlink(probe);
    }

    async stat(relative: string): Promise<HistoryStat | null> {
        if (!this.directory) {
            const stat = await this.adapter.stat(relative);
            if (stat && stat.type !== "file") throw new Error("History path is not a file.");
            return stat;
        }
        try {
            const stat = await this.fs.stat(this.location(relative));
            if (!stat.isFile()) throw new Error("History path is not a file.");
            return { mtime: stat.mtimeMs, size: stat.size };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                // A missing note archive is normal. A missing storage root
                // (for example a disconnected drive) must be reported.
                await this.fs.stat(this.directory);
                return null;
            }
            throw error;
        }
    }

    async read(relative: string): Promise<ArrayBuffer> {
        if (!this.directory) return this.adapter.readBinary(relative);
        const data = await this.fs.readFile(this.location(relative));
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    }

    async write(relative: string, data: ArrayBuffer): Promise<void> {
        if (!this.directory) {
            const parent = relative.substring(0, relative.lastIndexOf("/"));
            if (parent && !await this.adapter.exists(parent)) await this.adapter.mkdir(parent);
            return this.adapter.writeBinary(relative, data);
        }
        const target = this.location(relative);
        await this.fs.mkdir(this.path.dirname(target), { recursive: true });
        // Replace the complete archive only after the new archive is on disk.
        const temporary = this.path.join(this.path.dirname(target), `.edit-history-${require("crypto").randomBytes(8).toString("hex")}.tmp`);
        try {
            await this.fs.writeFile(temporary, Buffer.from(data), { flag: "wx" });
            await this.fs.rename(temporary, target);
        } finally {
            await this.fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") throw error;
            });
        }
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        if (!await this.stat(oldPath)) return;
        if (oldPath === newPath) return;
        const caseOnly = process.platform === "win32" && oldPath.toLowerCase() === newPath.toLowerCase();
        if (!caseOnly && await this.stat(newPath)) throw new Error("The destination already has edit history; no history was overwritten.");
        if (!this.directory) {
            const parent = newPath.substring(0, newPath.lastIndexOf("/"));
            if (parent && !await this.adapter.exists(parent)) await this.adapter.mkdir(parent);
            return this.adapter.rename(oldPath, newPath);
        }
        await this.fs.mkdir(this.path.dirname(this.location(newPath)), { recursive: true });
        await this.fs.rename(this.location(oldPath), this.location(newPath));
    }

    async remove(relative: string): Promise<void> {
        if (!await this.stat(relative)) return;
        if (!this.directory) return this.adapter.remove(relative);
        await this.fs.unlink(this.location(relative));
    }

    async renameFolder(oldPath: string, newPath: string): Promise<void> {
        if (!this.directory || oldPath === newPath) return;
        const source = this.location(oldPath);
        const target = this.location(newPath);
        try { await this.fs.stat(source); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
        }
        const caseOnly = process.platform === "win32" && source.toLowerCase() === target.toLowerCase();
        if (!caseOnly) {
            let destinationExists = false;
            try { await this.fs.stat(target); destinationExists = true; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
            if (destinationExists) {
                // Obsidian versions can emit child renames before the folder
                // rename. Merge the remaining archives without replacing any.
                for (const entry of await this.fs.readdir(source, { withFileTypes: true })) {
                    if (entry.isDirectory()) await this.renameFolder(oldPath + "/" + entry.name, newPath + "/" + entry.name);
                    else if (entry.isFile() && entry.name.endsWith(".edtz")) await this.rename(oldPath + "/" + entry.name, newPath + "/" + entry.name);
                }
                await this.fs.rmdir(source).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error; });
                return;
            }
        }
        await this.fs.mkdir(this.path.dirname(target), { recursive: true });
        await this.fs.rename(source, target);
    }

    async removeFolder(relative: string): Promise<void> {
        if (!this.directory) return;
        const folder = this.location(relative);
        // Remove history archives only, preserving any unrelated files.
        let entries: import("fs").Dirent[];
        try { entries = await this.fs.readdir(folder, { withFileTypes: true }); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
        }
        for (const entry of entries) {
            const child = relative + "/" + entry.name;
            if (entry.isDirectory()) await this.removeFolder(child);
            else if (entry.isFile() && entry.name.endsWith(".edtz")) await this.remove(child);
        }
        await this.fs.rmdir(folder).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
        });
    }
}

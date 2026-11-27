const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');
const { DiffMatchPatch } = require('diff-match-patch-ts');

function loadCode(code, obsidian = {}) {
    const module = { exports: {} };
    vm.runInNewContext(code, {
        module, exports: module.exports,
        require: name => name === 'obsidian' ? obsidian : require(name),
        process, Buffer, ArrayBuffer, Uint8Array, Date, console, setTimeout, clearTimeout, setImmediate, clearImmediate,
        document: obsidian.document, navigator: {}, createEl: obsidian.createEl,
        window: {setInterval:()=>0, setTimeout:()=>0, clearTimeout(){}},
    });
    return module.exports;
}
const { HistoryStorage } = loadCode(transformSync(require('node:fs').readFileSync('history-storage.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code);
const bytes = text => Uint8Array.from(Buffer.from(text)).buffer;
const text = data => Buffer.from(data).toString();

async function fixture(t) {
    // All fixtures remain inside the checkout's task-owned test directory.
    const root = await fs.mkdtemp(path.resolve('tests', 'fixture-'));
    t.after(async () => fs.rm(root, { recursive: true, force: true }));
    const vault = path.join(root, 'Vault');
    await fs.mkdir(vault);
    const adapter = {
        getBasePath: () => vault,
        async stat(p) {
            try { const s = await fs.stat(path.join(vault, p)); return { type: s.isFile() ? 'file' : 'folder', size: s.size, mtime: s.mtimeMs }; }
            catch (e) { if (e.code === 'ENOENT') return null; throw e; }
        },
        async exists(p) { return !!await this.stat(p); },
        async mkdir(p) { await fs.mkdir(path.join(vault, p), { recursive: true }); },
        async writeBinary(p, data) { await fs.writeFile(path.join(vault, p), Buffer.from(data)); },
        async readBinary(p) { const b = await fs.readFile(path.join(vault, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
        async rename(a, b) { await fs.rename(path.join(vault, a), path.join(vault, b)); },
        async remove(p) { await fs.unlink(path.join(vault, p)); },
    };
    return { root, vault, adapter, external: path.join(root, 'Backups with spaces') };
}

test('external archives round trip, replace atomically, move and delete outside the vault', async t => {
    const f = await fixture(t);
    const store = new HistoryStorage(f.adapter, f.external, f.vault);
    await store.validate(f.vault);
    assert.equal(await store.stat('nested/日本語.md.edtz'), null);
    await store.write('nested/日本語.md.edtz', bytes('first'));
    await store.write('nested/日本語.md.edtz', bytes('second'));
    assert.equal(text(await store.read('nested/日本語.md.edtz')), 'second');
    assert.equal((await store.stat('nested/日本語.md.edtz')).size, 6);
    assert.equal(await f.adapter.stat('nested/日本語.md.edtz'), null);
    assert.deepEqual(await fs.readdir(path.join(store.directory, 'nested')), ['日本語.md.edtz']);
    await store.rename('nested/日本語.md.edtz', 'new/deep/note.md.edtz');
    assert.equal(await store.stat('nested/日本語.md.edtz'), null);
    assert.equal(text(await store.read('new/deep/note.md.edtz')), 'second');
    await store.remove('new/deep/note.md.edtz');
    assert.equal(await store.stat('new/deep/note.md.edtz'), null);
    await fs.rename(store.directory, store.directory + '-offline');
    await assert.rejects(store.stat('missing.md.edtz')); // unavailable root is not an empty history
});

test('blank setting preserves original vault storage', async t => {
    const { adapter } = await fixture(t);
    const store = new HistoryStorage(adapter);
    await store.write('notes/n.md.edtz', bytes('legacy'));
    assert.equal(text(await adapter.readBinary('notes/n.md.edtz')), 'legacy');
    await store.rename('notes/n.md.edtz', 'elsewhere/n.md.edtz');
    assert.equal(text(await store.read('elsewhere/n.md.edtz')), 'legacy');
    await store.remove('elsewhere/n.md.edtz');
    assert.equal(await store.stat('elsewhere/n.md.edtz'), null);
});

test('long Windows note titles use short atomic temporary names and safe archive names', async t => {
    const f=await fixture(t),store=new HistoryStorage(f.adapter,f.external,f.vault);
    for(const length of [240,252]){const name='notes/'+'x'.repeat(length)+'.md.edtz';await store.write(name,bytes('Original'));await store.write(name,bytes('Updated'));assert.equal(text(await store.read(name)),'Updated');}
    const files=await fs.readdir(path.join(store.directory,'notes'));assert.equal(files.length,2);assert.ok(files.every(name=>name.length<=255&&!name.endsWith('.tmp')));
});

test('same backup root separates vault identities, including vaults with identical names', async t => {
    const f = await fixture(t);
    const first = new HistoryStorage(f.adapter, f.external, f.vault);
    const second = new HistoryStorage(f.adapter, f.external, path.join(f.root, 'other', 'Vault'));
    assert.notEqual(first.directory, second.directory);
    assert.equal(first.directory, new HistoryStorage(f.adapter, `"${f.external}"`, f.vault).directory);
    await first.write('same.md.edtz', bytes('A'));
    await second.write('same.md.edtz', bytes('B'));
    assert.equal(text(await first.read('same.md.edtz')), 'A');
    assert.equal(text(await second.read('same.md.edtz')), 'B');
});

test('rejects relative, drive-relative, inside-vault and traversal paths', async t => {
    const f = await fixture(t);
    for (const invalid of ['relative', 'D:relative', f.vault, path.join(f.vault, 'backups')]) {
        assert.throws(() => new HistoryStorage(f.adapter, invalid, f.vault));
    }
    const store = new HistoryStorage(f.adapter, f.external, f.vault);
    for (const invalid of ['../escape', '/absolute', 'C:/escape', '', '.', 'nested/../../escape']) {
        await assert.rejects(store.write(invalid, bytes('bad')));
    }
    if (process.platform === 'win32') {
        assert.throws(() => new HistoryStorage(f.adapter, '\\root-relative', f.vault));
        assert.match(new HistoryStorage(f.adapter, '\\\\server\\share\\backups', f.vault).directory, /^\\\\server\\share/);
    }
});

test('unavailable destination reports failure without saving an archive in the vault', async t => {
    const f = await fixture(t);
    const blocked = path.join(f.root, 'file-instead-of-directory');
    await fs.writeFile(blocked, 'blocked');
    const store = new HistoryStorage(f.adapter, blocked, f.vault);
    await assert.rejects(store.validate(f.vault));
    await assert.rejects(store.write('n.md.edtz', bytes('data')));
    assert.equal(await f.adapter.stat('n.md.edtz'), null);
});

test('file and folder renames protect existing archives and support either folder-event ordering', async t => {
    const f = await fixture(t);
    const store = new HistoryStorage(f.adapter, f.external, f.vault);
    await store.write('old/sub/a.md.edtz', bytes('a'));
    await store.write('old/sub/b.md.edtz', bytes('b'));
    await store.rename('old/sub/a.md.edtz', 'new/sub/a.md.edtz');
    await store.renameFolder('old', 'new');
    assert.equal(text(await store.read('new/sub/b.md.edtz')), 'b');
    await store.renameFolder('new', 'renamed');
    await store.rename('new/sub/a.md.edtz', 'renamed/sub/a.md.edtz'); // redundant child event
    await assert.rejects(store.rename('renamed/sub/a.md.edtz', 'renamed/sub/b.md.edtz'));
    assert.equal(text(await store.read('renamed/sub/b.md.edtz')), 'b');
    if (process.platform === 'win32') {
        await store.rename('renamed/sub/a.md.edtz', 'renamed/sub/A.md.edtz');
        await store.renameFolder('renamed', 'Renamed');
        assert.equal(text(await store.read('Renamed/sub/A.md.edtz')), 'a');
    }
    await fs.writeFile(path.join(store.directory, 'renamed', 'keep.txt'), 'unrelated');
    await store.removeFolder('renamed');
    assert.equal(await store.stat('renamed/sub/a.md.edtz'), null);
    assert.equal(await fs.readFile(path.join(store.directory, 'renamed', 'keep.txt'), 'utf8'), 'unrelated');
});

function mockObsidian(adapter) {
    const dom = new JSDOM('<div></div>');
    const { document, HTMLElement } = dom.window;
    const pendingUI = [];
    Object.assign(HTMLElement.prototype, {
        createEl(tag, options = {}) { const e = document.createElement(tag); e.textContent = options.text || ''; if (options.cls) e.className = options.cls; this.appendChild(e); return e; },
        createDiv(cls) { return this.createEl('div', { cls: typeof cls === 'string' ? cls : cls?.cls }); },
        setText(s) { this.textContent = s; return this; }, empty() { this.innerHTML = ''; },
        addClass(...c) { this.classList.add(...c); return this; }, removeClass(...c) { this.classList.remove(...c); return this; },
        setAttr(k, v) { this.setAttribute(k, v); }, toggle() {}, scrollIntoView() {},
        trigger(type) { this.dispatchEvent(new dom.window.Event(type)); },
    });
    class Plugin {
        async loadData() { return {}; } async saveData(data) { this.saved = { ...data }; }
        registerEvent() {} registerInterval() {} addCommand(c) { (this.commands ||= []).push(c); }
        addRibbonIcon() {} addStatusBarItem() { return document.createElement('div'); }
        addSettingTab(tab) { this.tab = tab; }
    }
    class Modal {
        constructor(app) { this.app = app; this.contentEl = document.createElement('div'); this.titleEl = document.createElement('div'); this.modalEl = document.createElement('div'); this.containerEl = document.createElement('div'); Modal.last = this; }
        open() { pendingUI.push(this.onOpen()); }
    }
    class Component {
        constructor(container) { this.buttonEl = container.createEl('button'); this.selectEl = container.createEl('select'); }
        setValue(value) { this.value = value; this.selectEl.value = value; return this; }
        getValue() { return this.selectEl.value || this.value; }
        setPlaceholder() { return this; } setButtonText() { return this; } setClass() { return this; } setCta() { return this; } setDisabled(v) { this.disabled = v; return this; }
        onClick(fn) { this.click = fn; return this; }
        onChange(fn) { this.change = fn; this.selectEl.addEventListener('change', () => pendingUI.push(Promise.resolve(fn(this.getValue())))); return this; }
        addOption(key, value) { const option = document.createElement('option'); option.value = key; option.text = value; this.selectEl.appendChild(option); return this; }
        addOptions(options) { for (const [key, value] of Object.entries(options)) this.addOption(key, value); return this; }
    }
    class Setting {
        static all = [];
        constructor(el) { this.el = el; Setting.all.push(this); }
        setName(name) { this.name = name; return this; } setDesc() { return this; }
        addText(fn) { fn(this.text = new Component(this.el)); return this; }
        addButton(fn) { fn(this.button = new Component(this.el)); return this; }
        addToggle(fn) { fn(new Component(this.el)); return this; } addDropdown(fn) { fn(new Component(this.el)); return this; }
    }
    class TFile { constructor(p) { this.path = p; this.name = path.basename(p); this.stat = { mtime: Date.now(), size: 0 }; } }
    class TFolder { constructor(p) { this.path = p; } }
    class FileSystemAdapter {}
    Object.setPrototypeOf(adapter, FileSystemAdapter.prototype);
    const notices = [];
    return { Plugin, Modal, PluginSettingTab: class { constructor(app) { this.app = app; this.containerEl = document.createElement('div'); } },
        TFile, TFolder, FileSystemAdapter, Setting, ButtonComponent: Component, DropdownComponent: Component, ToggleComponent: Component,
        Notice: class { constructor(message) { notices.push(message); } }, normalizePath: p => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
        setIcon() {}, document, createEl: (tag, opts) => document.createElement('div').createEl(tag, opts), notices, pendingUI, dom };
}

test('plugin settings, import, revision reconstruction, modal, queue, renames and deletion work together', async t => {
    const f = await fixture(t);
    const obsidian = mockObsidian(f.adapter);
    t.after(() => obsidian.dom.window.close());
    const EditHistory = loadCode(await fs.readFile('main.js', 'utf8'), obsidian).default;
    const plugin = new EditHistory();
    const handlers = {};
    const note = new obsidian.TFile('notes/n.md');
    let noteText = 'Starting note '.repeat(50);
    const originals = [];
    plugin.app = { vault: { adapter: f.adapter, on: (name, fn) => { handlers[name] = fn; }, read: async () => noteText,
        readBinary: file => f.adapter.readBinary(file.path), getFiles: () => originals }, workspace: { getActiveFile: () => note } };
    await plugin.onload();
    plugin.tab.display();
    const setting = obsidian.Setting.all.find(s => s.name === 'External backup directory');
    setting.text.change(f.external);
    assert.equal(plugin.settings.externalBackupDirectory, ''); // typing alone has no side effects
    await setting.button.click();
    assert.equal(plugin.settings.externalBackupDirectory, f.external);
    const directory = plugin.historyStorage().directory;
    const revision1 = noteText;
    const zip = new JSZip(); zip.file(plugin.buildEditFilename(note.stat.mtime - 10000, false), revision1);
    const legacy = 'notes/n.md.edtz';
    await fs.mkdir(path.join(f.vault, 'notes'));
    await f.adapter.writeBinary(legacy, await zip.generateAsync({ type: 'arraybuffer' }));
    originals.push(new obsidian.TFile(legacy));
    await plugin.importVaultHistory();
    assert.ok(await fs.stat(path.join(directory, legacy)));
    assert.ok(await f.adapter.stat(legacy));
    noteText = revision1 + 'A new paragraph'; note.stat.mtime += 10000;
    await handlers.modify(note, true);
    const copiedBefore = await fs.readFile(path.join(directory, legacy));
    await plugin.importVaultHistory();
    assert.deepEqual(await fs.readFile(path.join(directory, legacy)), copiedBefore); // no overwrite
    const archive = await JSZip.loadAsync(copiedBefore);
    const names = Object.keys(archive.files); plugin.sortEdits(names);
    assert.equal(names.length, 2);
    let restored = await archive.file(names[0]).async('string');
    assert.equal(restored, noteText);
    const old = await archive.file(names[1]).async('string');
    restored = names[1].endsWith('$') ? old : new DiffMatchPatch().patch_apply(new DiffMatchPatch().patch_fromText(old), restored)[0];
    assert.equal(restored, revision1);
    plugin.commands.find(c => c.id === 'open-edit-history').checkCallback(false);
    for (let i = 0; i < obsidian.pendingUI.length; i++) await obsidian.pendingUI[i];
    assert.equal(obsidian.Modal.last.currentVersionData, noteText);
    assert.match(obsidian.Modal.last.contentEl.textContent, /2 edits|A new paragraph/);
    note.path = 'notes/moved.md'; note.name = 'moved.md';
    await handlers.rename(note, 'notes/n.md');
    assert.ok(await plugin.historyStorage().stat('notes/moved.md.edtz'));
    await handlers.rename(new obsidian.TFolder('renamed'), 'notes');
    assert.ok(await plugin.historyStorage().stat('renamed/moved.md.edtz'));
    note.path = 'renamed/moved.md';
    await handlers.delete(note);
    assert.equal(await plugin.historyStorage().stat('renamed/moved.md.edtz'), null);
    const previous = plugin.settings.externalBackupDirectory;
    await assert.rejects(plugin.applyBackupDirectory('relative'));
    assert.equal(plugin.settings.externalBackupDirectory, previous);
    const saved = plugin.saveData;
    plugin.saveData = async () => { throw new Error('settings unavailable'); };
    await assert.rejects(plugin.applyBackupDirectory(path.join(f.root, 'another-location')));
    assert.equal(plugin.settings.externalBackupDirectory, previous);
    plugin.saveData = saved;
    const order = [];
    await Promise.all([plugin.queueHistoryOperation(async () => { await new Promise(resolve => setTimeout(resolve, 5)); order.push(1); }),
        plugin.queueHistoryOperation(async () => { order.push(2); })]);
    assert.deepEqual(order, [1, 2]);
    await plugin.applyBackupDirectory('');
    assert.equal(plugin.historyStorage().directory, '');
    assert.equal(obsidian.notices.some(n => n.startsWith('Edit History:')), false);
});

test('startup catches offline edits and late Android imports preserve every old revision without duplicates', async t => {
    const f=await fixture(t), obsidian=mockObsidian(f.adapter);t.after(()=>obsidian.dom.window.close());
    const EditHistory=loadCode(await fs.readFile('main.js','utf8'),obsidian).default;
    const note=new obsidian.TFile('note.md');let content='Original paragraph. '.repeat(40);
    note.stat.mtime=Date.now()-200000;const handlers={};
    const app={vault:{adapter:f.adapter,on:(name,fn)=>{handlers[name]=fn;},read:async()=>content,getFiles:()=>[note],getAbstractFileByPath:()=>note},workspace:{getActiveFile:()=>note}};
    const plugin=new EditHistory();plugin.app=app;await plugin.onload();await handlers.modify(note,true);const original=content;
    content+='Desktop change';note.stat.mtime+=100000;await handlers.modify(note,true);const desktop=content;
    // No modify event: only startup reconciliation sees this final synced version.
    content+=' Final mobile text';note.stat.mtime+=90000;await plugin.reconcileHistory();
    const archivePath=plugin.getEditHistoryFilepath(note.path);let zip=await JSZip.loadAsync(await plugin.historyStorage().read(archivePath));assert.equal(Object.keys(zip.files).length,3);
    const device='00000000-0000-4000-8000-000000000010';
    const mobile=(n,before,after,offset)=>({schema:1,id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),deviceId:device,path:note.path,kind:'edit',previousContent:before,content:after,capturedAt:new Date(Date.now()+offset).toISOString(),modifiedAt:Date.now()+offset,day:'2026-11-26',offsetMinutes:660,basis:'file-mtime'});
    const intermediate=desktop+' Phone intermediate';const records=[mobile(11,desktop,intermediate,-50000),mobile(12,intermediate,content,-10000)];
    plugin.mobileReader={readAll:async()=>records};await plugin.importMobileHistory();
    const once=await plugin.historyStorage().read(archivePath);zip=await JSZip.loadAsync(once);const values=await Promise.all(Object.keys(zip.files).map(name=>zip.file(name).async('string')));
    for(const expected of [original,desktop,intermediate,content])assert.ok(values.includes(expected));
    assert.ok(Object.keys(zip.files).every(name=>name.endsWith('$'))); // Imported older versions cannot break a backward patch chain.
    await plugin.importMobileHistory();assert.deepEqual(Buffer.from(await plugin.historyStorage().read(archivePath)),Buffer.from(once));
    const reopened=new EditHistory();reopened.app=app;await reopened.onload();reopened.mobileReader={readAll:async()=>records};await reopened.importMobileHistory();assert.deepEqual(Buffer.from(await reopened.historyStorage().read(archivePath)),Buffer.from(once));
    content+=' Another offline change';note.stat.mtime-=90000;await reopened.reconcileHistory();
    const finalZip=await JSZip.loadAsync(await reopened.historyStorage().read(archivePath));const names=Object.keys(finalZip.files);reopened.sortEdits(names);assert.equal(await finalZip.file(names[0]).async('string'),content);
});

test('same-second Android snapshots do not interrupt desktop reconstruction, import or viewing', async t => {
    const f=await fixture(t),obsidian=mockObsidian(f.adapter);t.after(()=>obsidian.dom.window.close());
    const EditHistory=loadCode(await fs.readFile('main.js','utf8'),obsidian).default;
    const plugin=new EditHistory(),note=new obsidian.TFile('note.md');
    const original='An intact archived paragraph. '.repeat(50),middle=original+' Desktop change',latest=middle+' Latest change';
    let content=latest;const t0=Math.floor(Date.now()/1000)*1000;
    const app={vault:{adapter:f.adapter,on:()=>({}),read:async()=>content,getFiles:()=>[note]},workspace:{getActiveFile:()=>note}};
    plugin.app=app;await plugin.onload();
    const patchName=plugin.buildEditFilename(t0-10000,true),latestName=plugin.buildEditFilename(t0,false);
    const oldName=plugin.buildEditFilename(t0-20000,false),prefix=plugin.buildEditFilename(t0-10000,false).slice(0,-1);
    const before=prefix+'~00000000-0000-4000-8000-000000000001-0-before$',after=prefix+'~00000000-0000-4000-8000-000000000001-1-edit$';
    const zip=new JSZip(),dmp=new DiffMatchPatch();
    zip.file(latestName,latest);zip.file(patchName,dmp.patch_toText(dmp.patch_make(latest,middle)));
    zip.file(before,'');zip.file(after,middle);zip.file(oldName,original);
    const expected=new Map([[latestName,latest],[patchName,middle],[before,''],[after,middle],[oldName,original]]);
    const reconstructed=await plugin.reconstructHistory(zip);
    for(const [name,value] of expected)assert.equal(reconstructed.get(name),value);
    const archivePath=plugin.getEditHistoryFilepath(note.path);await plugin.historyStorage().write(archivePath,await zip.generateAsync({type:'arraybuffer'}));
    // The viewer must use the same reconstruction as the importer.
    plugin.commands.find(c=>c.id==='open-edit-history').checkCallback(false);
    for(let i=0;i<obsidian.pendingUI.length;i++)await obsidian.pendingUI[i];
    const modal=obsidian.Modal.last,selects=modal.contentEl.querySelectorAll('select');
    selects[0].value=patchName;selects[0].dispatchEvent(new obsidian.dom.window.Event('change'));
    for(let i=0;i<obsidian.pendingUI.length;i++)await obsidian.pendingUI[i];
    assert.equal(modal.currentVersionData,middle);
    selects[1].value='TIMELINE';selects[1].dispatchEvent(new obsidian.dom.window.Event('change'));
    for(let i=0;i<obsidian.pendingUI.length;i++)await obsidian.pendingUI[i];
    assert.equal(modal.currentVersionData,middle);
    const record={schema:1,id:'00000000-0000-4000-8000-000000000002',deviceId:'00000000-0000-4000-8000-000000000003',path:note.path,kind:'edit',previousContent:latest,content:latest+' Phone edit',capturedAt:new Date(t0+10000).toISOString(),modifiedAt:t0+10000,day:'2026-11-27',offsetMinutes:660,basis:'file-mtime'};
    plugin.mobileReader={readAll:async()=>[record]};await plugin.importMobileHistory();
    assert.equal(plugin.lastHistoryError,'');
    let imported=await JSZip.loadAsync(await plugin.historyStorage().read(archivePath));
    for(const [name,value] of expected)assert.equal(await imported.file(name.endsWith('$')?name:name+'$').async('string'),value);
    const mobileName=Object.keys(imported.files).find(n=>n.includes(record.id)&&n.endsWith('-1-edit$'));
    assert.ok(mobileName);content=record.content+' Desktop edit after phone';note.stat.mtime=t0+20000;
    await plugin.saveFileHistory(note,true);
    const saved=await plugin.historyStorage().read(archivePath);imported=await JSZip.loadAsync(saved);
    assert.equal(await imported.file(mobileName).async('string'),record.content);
    const reopened=new EditHistory();reopened.app=app;await reopened.onload();reopened.mobileReader={readAll:async()=>[record]};
    await reopened.importMobileHistory();assert.deepEqual(Buffer.from(await reopened.historyStorage().read(archivePath)),Buffer.from(saved));
    assert.equal(obsidian.notices.some(n=>n.startsWith('Edit History:')),false);
});

test('genuinely broken patches leave the archive bytes and pending mobile records intact', async t => {
    const f=await fixture(t),obsidian=mockObsidian(f.adapter);t.after(()=>obsidian.dom.window.close());
    const EditHistory=loadCode(await fs.readFile('main.js','utf8'),obsidian).default,plugin=new EditHistory();
    plugin.app={vault:{adapter:f.adapter,on:()=>({}),getFiles:()=>[]},workspace:{getActiveFile:()=>null}};await plugin.onload();
    const zip=new JSZip(),dmp=new DiffMatchPatch();zip.file('300$', 'Entirely unrelated snapshot');
    zip.file('200',dmp.patch_toText(dmp.patch_make('x'.repeat(100),'y'.repeat(100))));
    const archivePath=plugin.getEditHistoryFilepath('broken.md'),saved=await zip.generateAsync({type:'arraybuffer'});await plugin.historyStorage().write(archivePath,saved);
    await assert.rejects(plugin.reconstructHistory(zip),/200; archive preserved/);
    const record={id:'00000000-0000-4000-8000-000000000004',path:'broken.md',kind:'baseline',content:'Pending full snapshot',modifiedAt:Date.now(),basis:'file-mtime',capturedAt:new Date().toISOString()};
    plugin.mobileReader={readAll:async()=>[record]};await plugin.importMobileHistory();
    assert.deepEqual(Buffer.from(await plugin.historyStorage().read(archivePath)),Buffer.from(saved));
    assert.equal(plugin.mobileSeen.has(record.id),false);assert.match(plugin.lastHistoryError,/archive preserved/);
});

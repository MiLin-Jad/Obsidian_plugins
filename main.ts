import { App, ColorComponent, ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, normalizePath } from "obsidian";

type FilenameDisplayMode = "show" | "hide" | "hover";
type UiLanguage = "en" | "zh";

interface CanvasFileNode {
	id?: string;
	type?: string;
	file?: string;
}

interface CanvasEdge {
	fromNode?: string;
	toNode?: string;
}

interface CanvasData {
	nodes?: CanvasFileNode[];
	edges?: CanvasEdge[];
}

interface RenameResult {
	sourcePath: string;
	targetPath: string;
}

interface BaseNameStyleRule {
	extension: string;
	color: string;
}

interface ImageAutoRenameSettings {
	settingsVersion: number;
	targetFolder: string;
	language: UiLanguage;
	filenameDisplayMode: FilenameDisplayMode;
	hidePngInFileList: boolean;
	baseNameStyleRules: BaseNameStyleRule[];
}

type LegacyImageAutoRenameSettings = Partial<ImageAutoRenameSettings> & {
	baseStyledExtension?: string;
	baseStyledNameColor?: string;
};

const DEFAULT_SETTINGS: ImageAutoRenameSettings = {
	settingsVersion: 3,
	targetFolder: "",
	language: "en",
	filenameDisplayMode: "hover",
	hidePngInFileList: true,
	baseNameStyleRules: [
		{
			extension: "canvas",
			color: "#f9a8d4",
		},
		{
			extension: "md",
			color: "#3f3f46",
		},
	],
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);
const PROCESSED_NAME_PATTERN = /^.+_\d{6}$/;
const IMAGE_AUTO_RENAME_VIEW_TYPE = "image-auto-rename-settings-view";
const DEFAULT_BASE_NAME_STYLE_COLOR = "#3f3f46";
const DEFAULT_BASE_FILE_NAME = "Files.base";
const DEFAULT_BASE_CONTENT = `filters:
  and:
    - 'file.ext != "png"'
    - 'file.ext != "base"'
properties:
  file.name:
    displayName: "名称"
  file.ext:
    displayName: "扩展名"
  file.tags:
    displayName: "tags"
  note.aliases:
    displayName: "aliases"
  file.backlinks:
    displayName: "文件反向链接"
  file.mtime:
    displayName: "修改时间"
views:
  - type: table
    name: "Files"
    order:
      - file.name
      - file.ext
      - file.tags
      - note.aliases
      - file.backlinks
      - file.mtime
`;

const UI_TEXT = {
	en: {
		pageTitle: "Rename_img",
		languageName: "Language",
		languageDesc: "Choose the display language for this plugin.",
		languageEnglish: "English",
		languageChinese: "中文",
		defaultImageFolderName: "Default image folder",
		defaultImageFolderDesc: "Folder used for newly created or pasted images. Leave empty to keep images in their original folder.",
		imageFilenameDisplayName: "Image filename display",
		imageFilenameDisplayDesc: "Controls whether Canvas image node file names are visible.",
		show: "Show",
		hide: "Hide",
		showOnHover: "Show on hover",
		hidePngName: "Hide PNG files in file list",
		hidePngDesc: "Hide .png files from Obsidian's file explorer. The files are only hidden visually and remain in the vault.",
		baseNameStyleRulesName: "Base name style rules",
		baseNameStyleRulesDesc: "Color and bold the Base name column by file extension. Add multiple rules for multiple extensions.",
		addBaseNameStyleRuleName: "Add Base name style rule",
		addBaseNameStyleRuleDesc: "Add another extension color rule.",
		addRuleButton: "Add rule",
		createDefaultBaseName: "Create default base",
		createDefaultBaseDesc: "Create a Base with filters for not PNG and not Base files, plus the preset visible properties.",
		createBaseButton: "Create base",
		creatingButton: "Creating...",
		renameImagesName: "Rename images in current note",
		renameImagesDesc: "Check every embedded image in the currently open note and rename unprocessed images.",
		checkAndRenameButton: "Check and rename",
		renamingButton: "Renaming...",
		baseStyleRuleName: "Base style rule",
		baseStyleRuleDesc: "Matching Base names are colored and bold.",
		removeButton: "Remove",
		noActiveFileNotice: "No active file found.",
		renameFailedNotice: "Failed to rename images in active file. See console for details.",
	},
	zh: {
		pageTitle: "Rename_img",
		languageName: "语言",
		languageDesc: "选择这个插件界面的显示语言。",
		languageEnglish: "English",
		languageChinese: "中文",
		defaultImageFolderName: "默认图片文件夹",
		defaultImageFolderDesc: "新建或粘贴图片时使用的文件夹。留空则保持图片原来的位置。",
		imageFilenameDisplayName: "图片文件名显示",
		imageFilenameDisplayDesc: "控制 Canvas 图片节点的文件名是否显示。",
		show: "显示",
		hide: "隐藏",
		showOnHover: "悬停显示",
		hidePngName: "在文件列表隐藏 PNG 文件",
		hidePngDesc: "从 Obsidian 文件列表中隐藏 .png 文件。文件只是在界面上隐藏，仍然保留在库中。",
		baseNameStyleRulesName: "Base 名称样式规则",
		baseNameStyleRulesDesc: "按扩展名给 Base 的名称列设置颜色并加粗。可以添加多条规则。",
		addBaseNameStyleRuleName: "添加 Base 名称样式规则",
		addBaseNameStyleRuleDesc: "添加另一条扩展名颜色规则。",
		addRuleButton: "添加规则",
		createDefaultBaseName: "创建默认 Base",
		createDefaultBaseDesc: "创建一个 Base，内置排除 PNG 和 Base 文件的过滤规则，并带有默认显示属性。",
		createBaseButton: "创建 Base",
		creatingButton: "创建中...",
		renameImagesName: "重命名当前笔记中的图片",
		renameImagesDesc: "检查当前打开笔记中嵌入的图片，并重命名未处理过的图片。",
		checkAndRenameButton: "检查并重命名",
		renamingButton: "重命名中...",
		baseStyleRuleName: "Base 样式规则",
		baseStyleRuleDesc: "匹配的 Base 名称会变成彩色并加粗。",
		removeButton: "删除",
		noActiveFileNotice: "没有找到当前文件。",
		renameFailedNotice: "重命名当前文件中的图片失败。请查看控制台了解详情。",
	},
} satisfies Record<UiLanguage, Record<string, string>>;

export default class ImageAutoRenamePlugin extends Plugin {
	settings: ImageAutoRenameSettings;
	private processingPaths = new Set<string>();
	private renameQueue = Promise.resolve();
	private fileListObserver: MutationObserver | null = null;
	private hiddenFileListElements = new Set<HTMLElement>();
	private baseStyleObserver: MutationObserver | null = null;
	private baseStyleTimeout: number | null = null;
	private baseStyleRetryTimeouts: number[] = [];

	async onload() {
		await this.loadSettings();
		this.applyFilenameDisplayCss();
		this.applyFileListCss();
		this.startBaseStyleObserver();
		this.scheduleBaseStyleRefresh();
		this.registerView(IMAGE_AUTO_RENAME_VIEW_TYPE, (leaf) => new ImageAutoRenameSettingsView(leaf, this));
		this.addSettingTab(new ImageAutoRenameSettingTab(this.app, this));
		this.addRibbonIcon("settings", this.t("pageTitle"), () => {
			void this.openSettingsView();
		});

		this.addCommand({
			id: "create-default-base",
			name: "Create default base",
			callback: () => {
				void this.createDefaultBase();
			},
		});
		this.addCommand({
			id: "open-settings-view",
			name: `Open ${this.t("pageTitle")} page`,
			callback: () => {
				void this.openSettingsView();
			},
		});
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.scheduleBaseStyleRefresh();
			})
		);
		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				this.scheduleBaseStyleRefresh();
			})
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.scheduleBaseStyleRefresh();
			})
		);

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					if (file instanceof TFile) {
						this.enqueueRename(file);
					}
				})
			);
			this.scheduleBaseStyleRefresh();
		});
	}

	private async openSettingsView() {
		const existingLeaf = this.app.workspace.getLeavesOfType(IMAGE_AUTO_RENAME_VIEW_TYPE)[0];
		const leaf = existingLeaf ?? this.app.workspace.getLeaf(true);

		await leaf.setViewState({
			type: IMAGE_AUTO_RENAME_VIEW_TYPE,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	t(key: keyof typeof UI_TEXT.en) {
		return UI_TEXT[this.settings.language]?.[key] ?? UI_TEXT.en[key];
	}

	normalizeLanguageSetting(language: string | undefined): UiLanguage {
		return language === "zh" || language === "en" ? language : DEFAULT_SETTINGS.language;
	}

	onunload() {
		this.removeFilenameDisplayCss();
		this.removeFileListCss();
		this.stopBaseStyleObserver();
		void this.saveSettings();
	}

	private enqueueRename(file: TFile) {
		const sourceFile = this.getActiveReferenceSource(file);

		this.renameQueue = this.renameQueue
			.then(async () => {
				const renameResult = await this.renameImage(file, sourceFile);

				if (renameResult && sourceFile) {
					void this.repairAutoRenameReferences(sourceFile, renameResult).catch((error) => {
						console.error("Failed to update renamed image references:", error);
					});
				}
			})
			.catch((error) => {
				console.error("Image auto rename queue failed:", error);
			});
	}

	private getActiveReferenceSource(file: TFile) {
		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile || activeFile.path === file.path) {
			return undefined;
		}

		return activeFile.extension === "md" || activeFile.extension === "canvas" ? activeFile : undefined;
	}

	async renameImagesInActiveNote() {
		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) {
			new Notice(this.t("noActiveFileNotice"));
			return;
		}

		this.renameQueue = this.renameQueue
			.then(() => this.renameImagesInFile(activeFile))
			.catch((error) => {
				console.error("Failed to rename images in active file:", error);
				new Notice(this.t("renameFailedNotice"));
			});

		await this.renameQueue;
	}

	async createDefaultBase() {
		try {
			const path = await this.getAvailableBasePath(DEFAULT_BASE_FILE_NAME);
			const baseFile = await this.app.vault.create(path, DEFAULT_BASE_CONTENT);
			await this.app.workspace.getLeaf(true).openFile(baseFile);
			new Notice(`Created base: ${path}`);
		} catch (error) {
			console.error("Failed to create default base:", error);
			new Notice("Failed to create base. See console for details.");
		}
	}

	private async getAvailableBasePath(fileName: string) {
		const extensionIndex = fileName.lastIndexOf(".");
		const basename = extensionIndex === -1 ? fileName : fileName.slice(0, extensionIndex);
		const extension = extensionIndex === -1 ? "" : fileName.slice(extensionIndex);
		let path = fileName;
		let index = 1;

		while (await this.app.vault.adapter.exists(path)) {
			path = `${basename} ${index}${extension}`;
			index += 1;
		}

		return path;
	}

	private async renameImagesInFile(sourceFile: TFile) {
		const removedMissingCount = sourceFile.extension === "canvas" ? await this.removeMissingCanvasImageNodes(sourceFile) : 0;
		const imageFiles = await this.getImageFilesInFile(sourceFile);

		if (imageFiles.length === 0) {
			new Notice(removedMissingCount > 0 ? `Removed ${removedMissingCount} missing image node(s).` : "No images found in current file.");
			return;
		}

		const renameResults = await this.normalizeImageSequence(sourceFile, imageFiles);

		if (sourceFile.extension === "canvas" && renameResults.length > 0) {
			await this.updateCanvasImageReferences(sourceFile, renameResults);
		}

		if (removedMissingCount > 0 || renameResults.length > 0) {
			await this.refreshOpenFileView(sourceFile);
		}

		new Notice(
			`Images checked: ${imageFiles.length}, renamed: ${renameResults.length}, unchanged: ${imageFiles.length - renameResults.length}, removed missing: ${removedMissingCount}.`
		);
	}

	private async getImageFilesInFile(sourceFile: TFile) {
		if (sourceFile.extension === "canvas") {
			return await this.getImageFilesInCanvas(sourceFile);
		}

		return this.getImageFilesInMarkdown(sourceFile);
	}

	private getImageFilesInMarkdown(sourceFile: TFile) {
		const cache = this.app.metadataCache.getFileCache(sourceFile);
		const imageFiles = new Map<string, TFile>();

		for (const embed of cache?.embeds ?? []) {
			const linkedFile = this.app.metadataCache.getFirstLinkpathDest(embed.link, sourceFile.path);

			if (linkedFile instanceof TFile && IMAGE_EXTENSIONS.has(linkedFile.extension.toLowerCase())) {
				imageFiles.set(linkedFile.path, linkedFile);
			}
		}

		return [...imageFiles.values()];
	}

	private async getImageFilesInCanvas(canvasFile: TFile) {
		const canvasData = await this.readCanvasData(canvasFile);
		const imageFiles = new Map<string, TFile>();

		for (const node of canvasData.nodes ?? []) {
			if (node.type !== "file" || !node.file) {
				continue;
			}

			const linkedFile = this.resolveLinkedFile(node.file, canvasFile.path);

			if (linkedFile instanceof TFile && IMAGE_EXTENSIONS.has(linkedFile.extension.toLowerCase())) {
				imageFiles.set(linkedFile.path, linkedFile);
			}
		}

		return [...imageFiles.values()];
	}

	private resolveLinkedFile(link: string, sourcePath: string) {
		const directFile = this.app.vault.getAbstractFileByPath(normalizePath(link));

		if (directFile instanceof TFile) {
			return directFile;
		}

		return this.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
	}

	private async readCanvasData(canvasFile: TFile) {
		const content = await this.app.vault.cachedRead(canvasFile);
		return JSON.parse(content) as CanvasData;
	}

	private async updateCanvasImageReferences(canvasFile: TFile, renameResults: RenameResult[]) {
		const content = await this.app.vault.cachedRead(canvasFile);
		const canvasData = JSON.parse(content) as CanvasData;
		let changed = false;

		for (const node of canvasData.nodes ?? []) {
			if (node.type !== "file" || !node.file) {
				continue;
			}

			const nodeFilePath = normalizePath(node.file);
			const linkedFile = this.resolveLinkedFile(node.file, canvasFile.path);
			const renameResult = renameResults.find(
				(result) =>
					this.linkMatchesRenameSource(node.file ?? "", result) ||
					result.sourcePath === node.file ||
					result.sourcePath === nodeFilePath ||
					result.targetPath === node.file ||
					result.targetPath === nodeFilePath ||
					result.targetPath === linkedFile?.path
			);

			if (renameResult && node.file !== renameResult.targetPath) {
				node.file = renameResult.targetPath;
				changed = true;
			}
		}

		if (changed) {
			await this.app.vault.modify(canvasFile, JSON.stringify(canvasData, null, "\t"));
		}

		return changed;
	}

	private async repairAutoRenameReferences(sourceFile: TFile, renameResult: RenameResult) {
		for (const delay of [0, 100, 300, 700, 1500]) {
			await this.sleep(delay);

			const latestSourceFile = this.app.vault.getAbstractFileByPath(sourceFile.path);

			if (!(latestSourceFile instanceof TFile)) {
				return;
			}

			const changed = await this.updateRenamedImageReferences(latestSourceFile, renameResult);

			if (changed) {
				return;
			}
		}
	}

	private async updateRenamedImageReferences(sourceFile: TFile, renameResult: RenameResult) {
		if (sourceFile.extension === "canvas") {
			return await this.updateCanvasImageReferences(sourceFile, [renameResult]);
		}

		if (sourceFile.extension !== "md") {
			return false;
		}

		return await this.updateMarkdownImageReferences(sourceFile, renameResult);
	}

	private async updateMarkdownImageReferences(markdownFile: TFile, renameResult: RenameResult) {
		const content = await this.app.vault.cachedRead(markdownFile);
		const updatedContent = this.replaceMarkdownImageReferences(content, renameResult);

		if (updatedContent === content) {
			return false;
		}

		await this.app.vault.modify(markdownFile, updatedContent);
		return true;
	}

	private replaceMarkdownImageReferences(content: string, renameResult: RenameResult) {
		const wikiLinkPattern = /(!?\[\[)([^\]]+)(\]\])/g;
		const markdownImagePattern = /(!\[[^\]]*\]\()([^)]+)(\))/g;

		return content
			.replace(wikiLinkPattern, (match, open: string, inner: string, close: string) => {
				if (!open.startsWith("!")) {
					return match;
				}

				const separatorIndex = inner.indexOf("|");
				const linkPart = separatorIndex === -1 ? inner : inner.slice(0, separatorIndex);
				const aliasPart = separatorIndex === -1 ? "" : inner.slice(separatorIndex);
				const headingIndex = linkPart.indexOf("#");
				const pathPart = headingIndex === -1 ? linkPart : linkPart.slice(0, headingIndex);
				const subpathPart = headingIndex === -1 ? "" : linkPart.slice(headingIndex);

				if (!this.linkMatchesRenameSource(pathPart, renameResult)) {
					return match;
				}

				return `${open}${renameResult.targetPath}${subpathPart}${aliasPart}${close}`;
			})
			.replace(markdownImagePattern, (match, open: string, destination: string, close: string) => {
				const parsedDestination = this.parseMarkdownDestination(destination);

				if (!this.linkMatchesRenameSource(parsedDestination.path, renameResult)) {
					return match;
				}

				return `${open}${this.formatMarkdownDestination(renameResult.targetPath, parsedDestination)}${close}`;
			});
	}

	private parseMarkdownDestination(destination: string) {
		const trimmedDestination = destination.trim();

		if (trimmedDestination.startsWith("<")) {
			const closingIndex = trimmedDestination.indexOf(">");

			if (closingIndex !== -1) {
				return {
					path: trimmedDestination.slice(1, closingIndex),
					prefix: "<",
					suffix: `>${trimmedDestination.slice(closingIndex + 1)}`,
				};
			}
		}

		const titleMatch = trimmedDestination.match(/^(\S+)(\s+["'][\s\S]+)$/);

		return {
			path: titleMatch ? titleMatch[1] : trimmedDestination,
			prefix: "",
			suffix: titleMatch ? titleMatch[2] : "",
		};
	}

	private formatMarkdownDestination(targetPath: string, destination: { prefix: string; suffix: string }) {
		if (destination.prefix === "<") {
			return `<${targetPath}>${destination.suffix.slice(1)}`;
		}

		return `${encodeURI(targetPath)}${destination.suffix}`;
	}

	private linkMatchesRenameSource(linkPath: string, renameResult: RenameResult) {
		const normalizedLinkPath = this.normalizeLinkPath(linkPath);
		const normalizedSourcePath = normalizePath(renameResult.sourcePath);
		const sourceFileName = normalizedSourcePath.split("/").pop() ?? normalizedSourcePath;

		return normalizedLinkPath === normalizedSourcePath || normalizedLinkPath === sourceFileName || normalizedLinkPath.endsWith(`/${sourceFileName}`);
	}

	private normalizeLinkPath(linkPath: string) {
		return normalizePath(this.decodeLinkPath(linkPath).trim());
	}

	private decodeLinkPath(linkPath: string) {
		try {
			return decodeURI(linkPath);
		} catch {
			return linkPath;
		}
	}

	private sleep(ms: number) {
		return new Promise((resolve) => window.setTimeout(resolve, ms));
	}

	private async removeMissingCanvasImageNodes(canvasFile: TFile) {
		const content = await this.app.vault.cachedRead(canvasFile);
		const canvasData = JSON.parse(content) as CanvasData;
		const removedNodeIds = new Set<string>();
		const originalNodes = canvasData.nodes ?? [];
		const remainingNodes = originalNodes.filter((node) => {
			if (node.type !== "file" || !node.file || !this.isImagePath(node.file)) {
				return true;
			}

			const linkedFile = this.resolveLinkedFile(node.file, canvasFile.path);

			if (linkedFile instanceof TFile) {
				return true;
			}

			if (node.id) {
				removedNodeIds.add(node.id);
			}

			return false;
		});

		if (remainingNodes.length === originalNodes.length) {
			return 0;
		}

		canvasData.nodes = remainingNodes;
		canvasData.edges = (canvasData.edges ?? []).filter((edge) => !removedNodeIds.has(edge.fromNode ?? "") && !removedNodeIds.has(edge.toNode ?? ""));
		await this.app.vault.modify(canvasFile, JSON.stringify(canvasData, null, "\t"));

		return originalNodes.length - remainingNodes.length;
	}

	private async normalizeImageSequence(sourceFile: TFile, imageFiles: TFile[]) {
		const projectName = this.getCurrentNoteName(imageFiles[0], sourceFile);
		const plans: RenameResult[] = [];
		const sourcePaths = new Set(imageFiles.map((file) => file.path));

		for (const [index, imageFile] of imageFiles.entries()) {
			const targetFolderPath = await this.getTargetFolderPath(imageFile);
			const sequenceText = this.formatSequence(index + 1);
			const targetPath = targetFolderPath
				? `${targetFolderPath}/${projectName}_${sequenceText}.${imageFile.extension.toLowerCase()}`
				: `${projectName}_${sequenceText}.${imageFile.extension.toLowerCase()}`;

			if (targetPath === imageFile.path) {
				continue;
			}

			if ((await this.app.vault.adapter.exists(targetPath)) && !sourcePaths.has(targetPath)) {
				new Notice(`Cannot rename images: target already exists: ${targetPath}`);
				return [];
			}

			plans.push({
				sourcePath: imageFile.path,
				targetPath,
			});
		}

		if (plans.length === 0) {
			return [];
		}

		const tempPlans = [];

		for (const [index, plan] of plans.entries()) {
			const sourceFileToRename = this.app.vault.getAbstractFileByPath(plan.sourcePath);

			if (!(sourceFileToRename instanceof TFile)) {
				continue;
			}

			const targetFolder = plan.targetPath.includes("/") ? plan.targetPath.slice(0, plan.targetPath.lastIndexOf("/")) : "";
			const tempPath = await this.getAvailableTempPath(targetFolder, sourceFileToRename.extension, index);

			await this.app.vault.rename(sourceFileToRename, tempPath);
			tempPlans.push({
				tempPath,
				targetPath: plan.targetPath,
			});
		}

		for (const plan of tempPlans) {
			const tempFile = this.app.vault.getAbstractFileByPath(plan.tempPath);

			if (tempFile instanceof TFile) {
				await this.app.vault.rename(tempFile, plan.targetPath);
			}
		}

		return plans;
	}

	private async getAvailableTempPath(folderPath: string, extension: string, index: number) {
		let attempt = 0;

		while (true) {
			const fileName = `.image-auto-rename-${Date.now()}-${index}-${attempt}.${extension.toLowerCase()}`;
			const tempPath = folderPath ? `${folderPath}/${fileName}` : fileName;

			if (!(await this.app.vault.adapter.exists(tempPath))) {
				return tempPath;
			}

			attempt += 1;
		}
	}

	private async refreshOpenFileView(file: TFile) {
		const viewType = file.extension === "canvas" ? "canvas" : "markdown";
		const leaves = this.app.workspace.getLeavesOfType(viewType);
		const currentLeaf = this.app.workspace.getLeaf(false);

		for (const leaf of leaves) {
			const leafFile = "file" in leaf.view ? leaf.view.file : null;

			if (leafFile instanceof TFile && leafFile.path === file.path) {
				await leaf.openFile(file, {
					active: leaf === currentLeaf,
				});
			}
		}
	}

	private async renameImage(file: TFile, noteFile?: TFile) {
		if (!this.shouldProcess(file)) {
			return null;
		}

		const sourcePath = file.path;

		if (this.processingPaths.has(sourcePath)) {
			return null;
		}

		this.processingPaths.add(sourcePath);

		try {
			const targetFolderPath = await this.getTargetFolderPath(file);
			const sourceFile = noteFile ?? this.app.workspace.getActiveFile() ?? undefined;
			const projectName = this.getCurrentNoteName(file, sourceFile);
			const extension = file.extension.toLowerCase();

			let targetPath: string;
			let sequence = await this.getNextSequence(projectName, targetFolderPath, sourceFile);

			do {
				const sequenceText = this.formatSequence(sequence);
				const fileName = `${projectName}_${sequenceText}.${extension}`;
				targetPath = targetFolderPath ? `${targetFolderPath}/${fileName}` : fileName;
				sequence += 1;
			} while (await this.app.vault.adapter.exists(targetPath));

			if (targetPath !== sourcePath) {
				await this.app.vault.rename(file, targetPath);
				return { sourcePath, targetPath };
			}

			return null;
		} catch (error) {
			console.error("Failed to auto rename image:", error);
			new Notice("Image auto rename failed. See console for details.");
			return null;
		} finally {
			this.processingPaths.delete(sourcePath);
		}
	}

	private shouldProcess(file: TFile) {
		if (!IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) {
			return false;
		}

		return !PROCESSED_NAME_PATTERN.test(file.basename);
	}

	private formatSequence(sequence: number) {
		return `000000${sequence}`.slice(-6);
	}

	private async getNextSequence(projectName: string, targetFolderPath: string, sourceFile?: TFile) {
		const usedSequences = new Set<number>();

		if (sourceFile) {
			const referencedBasenames = await this.getReferencedImageBasenamesInFile(sourceFile);

			for (const basename of referencedBasenames) {
				this.addSequenceFromBasename(usedSequences, projectName, basename);
			}

			const imageFiles = await this.getImageFilesInFile(sourceFile);

			for (const imageFile of imageFiles) {
				this.addSequenceFromBasename(usedSequences, projectName, imageFile.basename);
			}
		}

		const targetFolder = targetFolderPath
			? this.app.vault.getAbstractFileByPath(targetFolderPath)
			: this.app.vault.getRoot();

		if (targetFolder instanceof TFolder) {
			for (const child of targetFolder.children) {
				if (child instanceof TFile && IMAGE_EXTENSIONS.has(child.extension.toLowerCase())) {
					this.addSequenceFromBasename(usedSequences, projectName, child.basename);
				}
			}
		}

		return Math.max(0, ...usedSequences) + 1;
	}

	private async getReferencedImageBasenamesInFile(sourceFile: TFile) {
		if (sourceFile.extension === "canvas") {
			const canvasData = await this.readCanvasData(sourceFile);

			return (canvasData.nodes ?? [])
				.filter((node) => node.type === "file" && node.file && this.isImagePath(node.file))
				.map((node) => this.getBasenameFromPath(node.file ?? ""))
				.filter((basename) => basename.length > 0);
		}

		const cache = this.app.metadataCache.getFileCache(sourceFile);

		return (cache?.embeds ?? [])
			.map((embed) => embed.link)
			.filter((link) => this.isImagePath(link))
			.map((link) => this.getBasenameFromPath(link))
			.filter((basename) => basename.length > 0);
	}

	private isImagePath(path: string) {
		const cleanPath = path.split("#")[0].split("|")[0];
		const extension = cleanPath.split(".").pop()?.toLowerCase() ?? "";

		return IMAGE_EXTENSIONS.has(extension);
	}

	private getBasenameFromPath(path: string) {
		const cleanPath = normalizePath(path.split("#")[0].split("|")[0]);
		const fileName = cleanPath.split("/").pop() ?? "";
		const extensionIndex = fileName.lastIndexOf(".");

		return extensionIndex === -1 ? fileName : fileName.slice(0, extensionIndex);
	}

	private addSequenceFromBasename(sequences: Set<number>, projectName: string, basename: string) {
		const match = basename.match(new RegExp(`^${this.escapeRegExp(projectName)}_(\\d{6})$`));

		if (!match) {
			return;
		}

		const sequence = Number.parseInt(match[1], 10);

		if (Number.isFinite(sequence) && sequence > 0) {
			sequences.add(sequence);
		}
	}

	private escapeRegExp(value: string) {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	private getCurrentNoteName(file: TFile, noteFile?: TFile) {
		const activeFile = noteFile ?? this.app.workspace.getActiveFile();
		const rawName = activeFile?.basename ?? file.parent?.name ?? "Vault";

		const safeName = rawName
			.trim()
			.replace(/[\\/:*?"<>|#^[\]]+/g, "-")
			.replace(/\s+/g, "-");

		return safeName || "Vault";
	}

	private async getTargetFolderPath(file: TFile) {
		const configuredFolder = this.normalizeFolderPath(this.settings.targetFolder);
		const targetFolderPath = configuredFolder || file.parent?.path || "";

		await this.ensureFolderExists(targetFolderPath);

		return targetFolderPath;
	}

	private normalizeFolderPath(folderPath: string) {
		const normalizedPath = normalizePath(folderPath.trim());

		if (normalizedPath === "." || normalizedPath === "/") {
			return "";
		}

		return normalizedPath.replace(/^\/+|\/+$/g, "");
	}

	private async ensureFolderExists(folderPath: string) {
		if (!folderPath) {
			return;
		}

		const existingFile = this.app.vault.getAbstractFileByPath(folderPath);

		if (existingFile instanceof TFolder) {
			return;
		}

		if (existingFile) {
			throw new Error(`Target path exists but is not a folder: ${folderPath}`);
		}

		const parts = folderPath.split("/");
		let currentPath = "";

		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;

			const folder = this.app.vault.getAbstractFileByPath(currentPath);

			if (!folder) {
				await this.app.vault.createFolder(currentPath);
				continue;
			}

			if (!(folder instanceof TFolder)) {
				throw new Error(`Target path exists but is not a folder: ${currentPath}`);
			}
		}
	}

	private async loadSettings() {
		const loadedSettings = (await this.loadData()) as LegacyImageAutoRenameSettings | null;
		this.settings = this.normalizeSettings(loadedSettings);
	}

	async saveSettings() {
		this.settings = this.normalizeSettings(this.settings);
		await this.saveData({ ...this.settings });
	}

	private normalizeSettings(settings?: LegacyImageAutoRenameSettings | null): ImageAutoRenameSettings {
		const isLegacySettings = settings?.settingsVersion !== DEFAULT_SETTINGS.settingsVersion;
		const filenameDisplayMode = settings?.filenameDisplayMode ?? DEFAULT_SETTINGS.filenameDisplayMode;
		const hidePngInFileList = typeof settings?.hidePngInFileList === "boolean" ? settings.hidePngInFileList : DEFAULT_SETTINGS.hidePngInFileList;

		return {
			settingsVersion: DEFAULT_SETTINGS.settingsVersion,
			targetFolder: settings?.targetFolder ?? DEFAULT_SETTINGS.targetFolder,
			language: this.normalizeLanguageSetting(settings?.language),
			filenameDisplayMode: this.normalizeFilenameDisplayMode(filenameDisplayMode, isLegacySettings),
			hidePngInFileList: isLegacySettings && hidePngInFileList === false ? DEFAULT_SETTINGS.hidePngInFileList : hidePngInFileList,
			baseNameStyleRules: this.normalizeBaseNameStyleRules(settings, isLegacySettings),
		};
	}

	private normalizeFilenameDisplayMode(value: string, isLegacySettings: boolean): FilenameDisplayMode {
		if (isLegacySettings && value === "show") {
			return DEFAULT_SETTINGS.filenameDisplayMode;
		}

		return ["show", "hide", "hover"].includes(value) ? (value as FilenameDisplayMode) : DEFAULT_SETTINGS.filenameDisplayMode;
	}

	normalizeColorSetting(color: string | undefined) {
		return this.normalizeOptionalColorSetting(color) ?? DEFAULT_BASE_NAME_STYLE_COLOR;
	}

	normalizeOptionalColorSetting(color: string | undefined) {
		const normalizedColor = (color ?? "").trim();
		const colorWithHash = normalizedColor.startsWith("#") ? normalizedColor : `#${normalizedColor}`;
		return /^#[0-9a-f]{6}$/i.test(colorWithHash) ? colorWithHash : null;
	}

	private normalizeBaseNameStyleRules(settings: LegacyImageAutoRenameSettings | null | undefined, isLegacySettings: boolean) {
		if (Array.isArray(settings?.baseNameStyleRules)) {
			return settings.baseNameStyleRules
				.map((rule) => this.normalizeBaseNameStyleRule(rule))
				.filter((rule): rule is BaseNameStyleRule => rule !== null);
		}

		const legacyExtension = this.normalizeExtensionSetting(settings?.baseStyledExtension ?? "");

		if (!legacyExtension && isLegacySettings) {
			return this.getDefaultBaseNameStyleRules();
		}

		if (!legacyExtension) {
			return [];
		}

		return [
			{
				extension: legacyExtension,
				color: this.normalizeColorSetting(settings?.baseStyledNameColor),
			},
		];
	}

	private getDefaultBaseNameStyleRules() {
		return DEFAULT_SETTINGS.baseNameStyleRules.map((rule) => ({ ...rule }));
	}

	private normalizeBaseNameStyleRule(rule: Partial<BaseNameStyleRule> | null | undefined) {
		const extension = this.normalizeExtensionSetting(rule?.extension ?? "");

		if (!extension) {
			return null;
		}

		return {
			extension,
			color: this.normalizeColorSetting(rule?.color),
		};
	}

	private getActiveDocument(): Document {
		return activeDocument;
	}

	applyFilenameDisplayCss() {
		this.removeFilenameDisplayCss();

		const body = this.getActiveDocument().body;
		body.classList.toggle("image-auto-rename-filename-hide", this.settings.filenameDisplayMode === "hide");
		body.classList.toggle("image-auto-rename-filename-hover", this.settings.filenameDisplayMode === "hover");
	}

	private removeFilenameDisplayCss() {
		const body = this.getActiveDocument().body;
		body.classList.remove("image-auto-rename-filename-hide", "image-auto-rename-filename-hover");
	}

	applyFileListCss() {
		if (!this.settings.hidePngInFileList) {
			this.removeFileListCss();
			return;
		}

		this.startFileListObserver();
		this.refreshFileListVisibility();
	}

	private removeFileListCss() {
		this.fileListObserver?.disconnect();
		this.fileListObserver = null;
		this.clearHiddenFileListElements();
	}

	private startFileListObserver() {
		if (this.fileListObserver) {
			return;
		}

		this.fileListObserver = new MutationObserver(() => {
			this.refreshFileListVisibility();
		});
		this.fileListObserver.observe(this.getActiveDocument().body, {
			childList: true,
			subtree: true,
		});
	}

	private refreshFileListVisibility() {
		this.clearHiddenFileListElements();

		if (!this.settings.hidePngInFileList) {
			return;
		}

		const selector = ".nav-file-title[data-path], .tree-item-self[data-path]";

		for (const element of Array.from(this.getActiveDocument().querySelectorAll<HTMLElement>(selector))) {
			const path = element.getAttribute("data-path") ?? "";

			if (!path.toLowerCase().endsWith(".png")) {
				continue;
			}

			element.classList.add("image-auto-rename-hidden-file");
			this.hiddenFileListElements.add(element);

			const container = element.closest<HTMLElement>(".nav-file, .tree-item");

			if (container) {
				container.classList.add("image-auto-rename-hidden-file-container");
				this.hiddenFileListElements.add(container);
			}
		}
	}

	private clearHiddenFileListElements() {
		for (const element of this.hiddenFileListElements) {
			element.classList.remove("image-auto-rename-hidden-file", "image-auto-rename-hidden-file-container");
		}

		this.hiddenFileListElements.clear();
	}

	getAvailableBaseStyleExtensions() {
		return ["base", "canvas", "gif", "jpeg", "jpg", "md", "pdf", "png", "webp"];
	}

	refreshBaseNameStyles() {
		this.clearBaseNameStyles();
		this.scheduleBaseStyleRefresh();
	}

	private scheduleBaseStyleRefresh() {
		this.clearBaseStyleRetryTimeouts();
		this.queueApplyBaseNameStyles();

		for (const delay of [250, 1000, 2500, 5000]) {
			const timeoutId = window.setTimeout(() => {
				this.baseStyleRetryTimeouts = this.baseStyleRetryTimeouts.filter((id) => id !== timeoutId);
				this.queueApplyBaseNameStyles();
			}, delay);

			this.baseStyleRetryTimeouts.push(timeoutId);
		}
	}

	private clearBaseStyleRetryTimeouts() {
		for (const timeoutId of this.baseStyleRetryTimeouts) {
			window.clearTimeout(timeoutId);
		}

		this.baseStyleRetryTimeouts = [];
	}

	private startBaseStyleObserver() {
		this.stopBaseStyleObserver();

		this.baseStyleObserver = new MutationObserver(() => {
			this.queueApplyBaseNameStyles();
		});
		this.baseStyleObserver.observe(this.getActiveDocument().body, {
			childList: true,
			subtree: true,
		});
	}

	private stopBaseStyleObserver() {
		this.baseStyleObserver?.disconnect();
		this.baseStyleObserver = null;

		if (this.baseStyleTimeout !== null) {
			window.clearTimeout(this.baseStyleTimeout);
			this.baseStyleTimeout = null;
		}

		this.clearBaseStyleRetryTimeouts();
		this.clearBaseNameStyles();
	}

	private queueApplyBaseNameStyles() {
		if (this.baseStyleTimeout !== null) {
			return;
		}

		this.baseStyleTimeout = window.setTimeout(() => {
			this.baseStyleTimeout = null;
			this.applyBaseNameStyles();
		}, 100);
	}

	private applyBaseNameStyles() {
		this.clearBaseNameStyles();

		const ruleByExtension = new Map(this.settings.baseNameStyleRules.map((rule) => [rule.extension, rule]));

		if (ruleByExtension.size === 0) {
			return;
		}

		for (const row of this.getBaseRows()) {
			const extensionCell = this.getBaseCell(row, ["file.ext", "file.extension"]);
			const nameCell = this.getBaseCell(row, ["file.name", "file.path"]);

			if (!extensionCell || !nameCell) {
				continue;
			}

			const rule = this.getBaseNameStyleRuleForCell(extensionCell, ruleByExtension);

			if (!rule) {
				continue;
			}

			this.styleBaseNameCell(nameCell, rule.color);
		}
	}

	private clearBaseNameStyles() {
		for (const element of Array.from(this.getActiveDocument().querySelectorAll<HTMLElement>("[data-image-auto-rename-base-name-style='true']"))) {
			element.classList.remove("image-auto-rename-base-name-styled");
			element.setCssProps({
				"--image-auto-rename-base-name-color": "",
			});
			element.removeAttribute("data-image-auto-rename-base-name-style");
		}
	}

	private getBaseRows() {
		const cellSelector = this.getBasePropertySelector(["file.ext", "file.extension", "file.name", "file.path"]);
		const rows = new Set<HTMLElement>();

		for (const cell of Array.from(this.getActiveDocument().querySelectorAll<HTMLElement>(cellSelector))) {
			const row = cell.closest<HTMLElement>(".bases-tr, .bases-table-row, tr, [role='row']");

			if (row) {
				rows.add(row);
			}
		}

		return [...rows];
	}

	private getBaseCell(row: HTMLElement, properties: string[]) {
		const selector = this.getBasePropertySelector(properties);
		return row.querySelector<HTMLElement>(selector);
	}

	private getBasePropertySelector(properties: string[]) {
		const attributes = ["data-property", "data-property-key", "data-property-name", "data-column-id", "data-column-key", "aria-label"];
		return properties
			.flatMap((property) => attributes.map((attribute) => `[${attribute}='${property}']`))
			.join(", ");
	}

	private getBaseNameStyleRuleForCell(extensionCell: HTMLElement, ruleByExtension: Map<string, BaseNameStyleRule>) {
		const rawExtension = extensionCell.textContent ?? "";
		const normalizedExtension = this.normalizeExtensionSetting(rawExtension);
		const directRule = ruleByExtension.get(normalizedExtension);

		if (directRule) {
			return directRule;
		}

		for (const token of this.getExtensionTokens(rawExtension)) {
			const rule = ruleByExtension.get(token);

			if (rule) {
				return rule;
			}
		}

		return null;
	}

	private getExtensionTokens(value: string) {
		const normalizedValue = value.toLowerCase();
		const tokens = new Set<string>();

		for (const token of normalizedValue.split(/[^a-z0-9]+/i)) {
			const extension = this.normalizeExtensionSetting(token);

			if (extension) {
				tokens.add(extension);
			}
		}

		const fileExtensionMatch = normalizedValue.match(/\.([a-z0-9]+)(?:\s|$)/i);

		if (fileExtensionMatch?.[1]) {
			tokens.add(this.normalizeExtensionSetting(fileExtensionMatch[1]));
		}

		return [...tokens];
	}

	private styleBaseNameCell(nameCell: HTMLElement, color: string) {
		const targets = nameCell.querySelectorAll<HTMLElement>("a, span, div");
		const elements = [nameCell, ...Array.from(targets)];

		for (const element of elements) {
			element.classList.add("image-auto-rename-base-name-styled");
			element.setCssProps({
				"--image-auto-rename-base-name-color": color,
			});
			element.setAttribute("data-image-auto-rename-base-name-style", "true");
		}
	}

	normalizeExtensionSetting(extension: string) {
		return extension.trim().replace(/^\./, "").toLowerCase();
	}
}

class ImageAutoRenameSettingsView extends ItemView {
	private plugin: ImageAutoRenamePlugin;
	private settingTab: ImageAutoRenameSettingTab;

	constructor(leaf: WorkspaceLeaf, plugin: ImageAutoRenamePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.settingTab = new ImageAutoRenameSettingTab(plugin.app, plugin);
	}

	getViewType() {
		return IMAGE_AUTO_RENAME_VIEW_TYPE;
	}

	getDisplayText() {
		return this.plugin.t("pageTitle");
	}

	getIcon() {
		return "settings";
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass("image-auto-rename-settings-view");
		this.settingTab.renderInto(this.contentEl);
	}

	async onClose() {
		this.contentEl.removeClass("image-auto-rename-settings-view");
	}
}

class ImageAutoRenameSettingTab extends PluginSettingTab {
	plugin: ImageAutoRenamePlugin;

	constructor(app: App, plugin: ImageAutoRenamePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		this.renderInto(this.containerEl);
	}

	renderInto(containerEl: HTMLElement) {
		containerEl.empty();
		containerEl.createEl("h2", {
			text: this.plugin.t("pageTitle"),
		});

		new Setting(containerEl)
			.setName(this.plugin.t("languageName"))
			.setDesc(this.plugin.t("languageDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("en", this.plugin.t("languageEnglish"))
					.addOption("zh", this.plugin.t("languageChinese"))
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = this.plugin.normalizeLanguageSetting(value);
						await this.plugin.saveSettings();
						this.renderInto(containerEl);
					})
			);

		new Setting(containerEl)
			.setName(this.plugin.t("defaultImageFolderName"))
			.setDesc(this.plugin.t("defaultImageFolderDesc"))
			.addText((text) =>
				text
					.setPlaceholder("Assets/Images")
					.setValue(this.plugin.settings.targetFolder)
					.onChange(async (value) => {
						this.plugin.settings.targetFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(this.plugin.t("imageFilenameDisplayName"))
			.setDesc(this.plugin.t("imageFilenameDisplayDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("show", this.plugin.t("show"))
					.addOption("hide", this.plugin.t("hide"))
					.addOption("hover", this.plugin.t("showOnHover"))
					.setValue(this.plugin.settings.filenameDisplayMode)
					.onChange(async (value) => {
						this.plugin.settings.filenameDisplayMode = value as FilenameDisplayMode;
						await this.plugin.saveSettings();
						this.plugin.applyFilenameDisplayCss();
					})
			);

		new Setting(containerEl)
			.setName(this.plugin.t("hidePngName"))
			.setDesc(this.plugin.t("hidePngDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hidePngInFileList)
					.onChange(async (value) => {
						this.plugin.settings.hidePngInFileList = value;
						await this.plugin.saveSettings();
						this.plugin.applyFileListCss();
					})
			);

		new Setting(containerEl)
			.setName(this.plugin.t("baseNameStyleRulesName"))
			.setDesc(this.plugin.t("baseNameStyleRulesDesc"));

		this.plugin.settings.baseNameStyleRules.forEach((rule, index) => {
			this.addBaseNameStyleRuleSetting(containerEl, rule, index);
		});

		new Setting(containerEl)
			.setName(this.plugin.t("addBaseNameStyleRuleName"))
			.setDesc(this.plugin.t("addBaseNameStyleRuleDesc"))
			.addButton((button) =>
				button
					.setButtonText(this.plugin.t("addRuleButton"))
					.setCta()
					.onClick(async () => {
						const extensions = this.plugin.getAvailableBaseStyleExtensions();
						const usedExtensions = new Set(this.plugin.settings.baseNameStyleRules.map((rule) => rule.extension));
						const extension = extensions.find((value) => !usedExtensions.has(value)) ?? extensions[0] ?? "md";

						this.plugin.settings.baseNameStyleRules.push({
							extension,
							color: DEFAULT_BASE_NAME_STYLE_COLOR,
						});
						await this.plugin.saveSettings();
						this.plugin.refreshBaseNameStyles();
						this.renderInto(containerEl);
					})
			);

		new Setting(containerEl)
			.setName(this.plugin.t("createDefaultBaseName"))
			.setDesc(this.plugin.t("createDefaultBaseDesc"))
			.addButton((button) =>
				button
					.setButtonText(this.plugin.t("createBaseButton"))
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText(this.plugin.t("creatingButton"));

						try {
							await this.plugin.createDefaultBase();
						} finally {
							button.setDisabled(false);
							button.setButtonText(this.plugin.t("createBaseButton"));
						}
					})
			);

		new Setting(containerEl)
			.setName(this.plugin.t("renameImagesName"))
			.setDesc(this.plugin.t("renameImagesDesc"))
			.addButton((button) =>
				button
					.setButtonText(this.plugin.t("checkAndRenameButton"))
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText(this.plugin.t("renamingButton"));

						try {
							await this.plugin.renameImagesInActiveNote();
						} finally {
							button.setDisabled(false);
							button.setButtonText(this.plugin.t("checkAndRenameButton"));
						}
					})
			);
	}

	private addBaseNameStyleRuleSetting(containerEl: HTMLElement, rule: BaseNameStyleRule, index: number) {
		let colorPicker: ColorComponent | null = null;
		const currentColor = this.plugin.normalizeColorSetting(rule.color);

		new Setting(containerEl)
			.setName(`${this.plugin.t("baseStyleRuleName")} ${index + 1}`)
			.setDesc(this.plugin.t("baseStyleRuleDesc"))
			.addDropdown((dropdown) => {
				const extensions = this.plugin.getAvailableBaseStyleExtensions();
				const currentExtension = this.plugin.normalizeExtensionSetting(rule.extension);

				for (const extension of extensions) {
					dropdown.addOption(extension, extension);
				}

				if (currentExtension && !extensions.includes(currentExtension)) {
					dropdown.addOption(currentExtension, currentExtension);
				}

				dropdown.setValue(currentExtension).onChange(async (value) => {
					this.plugin.settings.baseNameStyleRules[index] = {
						...this.plugin.settings.baseNameStyleRules[index],
						extension: this.plugin.normalizeExtensionSetting(value),
					};
					await this.plugin.saveSettings();
					this.plugin.refreshBaseNameStyles();
					this.renderInto(containerEl);
				});
			})
			.addText((text) =>
				text
					.setPlaceholder("#3f3f46")
					.setValue(currentColor)
					.onChange(async (value) => {
						const color = this.plugin.normalizeOptionalColorSetting(value);

						if (!color) {
							return;
						}

						colorPicker?.setValue(color);
						await this.updateBaseNameStyleRuleColor(index, color);
					})
			)
			.addColorPicker((color) => {
				colorPicker = color;
				color
					.setValue(currentColor)
					.onChange(async (value) => {
						await this.updateBaseNameStyleRuleColor(index, value);
					});
			})
			.addButton((button) =>
				button
					.setButtonText(this.plugin.t("removeButton"))
					.onClick(async () => {
						this.plugin.settings.baseNameStyleRules.splice(index, 1);
						await this.plugin.saveSettings();
						this.plugin.refreshBaseNameStyles();
						this.renderInto(containerEl);
					})
			);
	}

	private async updateBaseNameStyleRuleColor(index: number, color: string) {
		this.plugin.settings.baseNameStyleRules[index] = {
			...this.plugin.settings.baseNameStyleRules[index],
			color,
		};
		await this.plugin.saveSettings();
		this.plugin.refreshBaseNameStyles();
	}
}

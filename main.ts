import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath } from "obsidian";

type FilenameDisplayMode = "show" | "hide" | "hover";

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

interface ImageAutoRenameSettings {
	targetFolder: string;
	filenameDisplayMode: FilenameDisplayMode;
}

const DEFAULT_SETTINGS: ImageAutoRenameSettings = {
	targetFolder: "",
	filenameDisplayMode: "show",
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);
const PROCESSED_NAME_PATTERN = /^.+_\d{6}$/;
const FILENAME_HIDE_CLASS = "image-auto-rename-filenames-hidden";
const FILENAME_HOVER_CLASS = "image-auto-rename-filenames-hover";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function isFilenameDisplayMode(value: unknown): value is FilenameDisplayMode {
	return value === "show" || value === "hide" || value === "hover";
}

function isCanvasFileNode(value: unknown): value is CanvasFileNode {
	return isRecord(value) && isOptionalString(value.id) && isOptionalString(value.type) && isOptionalString(value.file);
}

function isCanvasEdge(value: unknown): value is CanvasEdge {
	return isRecord(value) && isOptionalString(value.fromNode) && isOptionalString(value.toNode);
}

function isCanvasData(value: unknown): value is CanvasData {
	if (!isRecord(value)) {
		return false;
	}

	const { nodes, edges } = value;
	return (nodes === undefined || (Array.isArray(nodes) && nodes.every(isCanvasFileNode))) && (edges === undefined || (Array.isArray(edges) && edges.every(isCanvasEdge)));
}

export default class ImageAutoRenamePlugin extends Plugin {
	settings: ImageAutoRenameSettings;
	private processingPaths = new Set<string>();
	private renameQueue = Promise.resolve();

	async onload() {
		await this.loadSettings();
		this.applyFilenameDisplayMode();
		this.addSettingTab(new ImageAutoRenameSettingTab(this.app, this));

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile) {
					this.enqueueRename(file);
				}
			})
		);
	}

	onunload() {
		this.clearFilenameDisplayMode();
		void this.saveSettings();
	}

	private enqueueRename(file: TFile) {
		this.renameQueue = this.renameQueue
			.then(async () => {
				await this.renameImage(file);
			})
			.catch((error) => {
				console.error("Image auto rename queue failed:", error);
			});
	}

	async renameImagesInActiveNote() {
		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) {
			new Notice("No active file found.");
			return;
		}

		this.renameQueue = this.renameQueue
			.then(() => this.renameImagesInFile(activeFile))
			.catch((error) => {
				console.error("Failed to rename images in active file:", error);
				new Notice("Failed to rename images in active file. See console for details.");
			});

		await this.renameQueue;
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

	private async readCanvasData(canvasFile: TFile): Promise<CanvasData> {
		const content = await this.app.vault.cachedRead(canvasFile);
		return this.parseCanvasData(content);
	}

	private async updateCanvasImageReferences(canvasFile: TFile, renameResults: RenameResult[]): Promise<void> {
		const content = await this.app.vault.cachedRead(canvasFile);
		const canvasData = this.parseCanvasData(content);
		let changed = false;

		for (const node of canvasData.nodes ?? []) {
			if (node.type !== "file" || !node.file) {
				continue;
			}

			const nodeFilePath = normalizePath(node.file);
			const linkedFile = this.resolveLinkedFile(node.file, canvasFile.path);
			const renameResult = renameResults.find(
				(result) =>
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
	}

	private async removeMissingCanvasImageNodes(canvasFile: TFile): Promise<number> {
		const content = await this.app.vault.cachedRead(canvasFile);
		const canvasData = this.parseCanvasData(content);
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

	private async normalizeImageSequence(sourceFile: TFile, imageFiles: TFile[]): Promise<RenameResult[]> {
		const projectName = this.getCurrentNoteName(imageFiles[0], sourceFile);
		const plans: RenameResult[] = [];
		const sourcePaths = new Set(imageFiles.map((file) => file.path));

		for (const [index, imageFile] of imageFiles.entries()) {
			const targetFolderPath = await this.getTargetFolderPath(imageFile);
			const sequenceText = String(index + 1).padStart(6, "0");
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

	private async getAvailableTempPath(folderPath: string, extension: string, index: number): Promise<string> {
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

		for (const leaf of leaves) {
			const leafFile = "file" in leaf.view ? leaf.view.file : null;

			if (leafFile instanceof TFile && leafFile.path === file.path) {
				await leaf.openFile(file);
			}
		}
	}

	private async renameImage(file: TFile, noteFile?: TFile): Promise<RenameResult | null> {
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
				const sequenceText = String(sequence).padStart(6, "0");
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

	private async getNextSequence(projectName: string, targetFolderPath: string, sourceFile?: TFile): Promise<number> {
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

	private async getReferencedImageBasenamesInFile(sourceFile: TFile): Promise<string[]> {
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

	private async getTargetFolderPath(file: TFile): Promise<string> {
		const configuredFolder = this.normalizeFolderPath(this.settings.targetFolder);
		const targetFolderPath = configuredFolder || file.parent?.path || "";

		await this.ensureFolderExists(targetFolderPath);

		return targetFolderPath;
	}

	private normalizeFolderPath(folderPath: string): string {
		const normalizedPath = normalizePath(folderPath.trim());

		if (normalizedPath === "." || normalizedPath === "/") {
			return "";
		}

		return normalizedPath.replace(/^\/+|\/+$/g, "");
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
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

	private async loadSettings(): Promise<void> {
		const loadedData = (await this.loadData()) as unknown;
		const loadedSettings = this.parseSettings(loadedData);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private parseCanvasData(content: string): CanvasData {
		const parsed = JSON.parse(content) as unknown;

		if (!isCanvasData(parsed)) {
			throw new Error("Invalid canvas data.");
		}

		return parsed;
	}

	private parseSettings(value: unknown): Partial<ImageAutoRenameSettings> {
		if (!isRecord(value)) {
			return {};
		}

		const settings: Partial<ImageAutoRenameSettings> = {};

		if (typeof value.targetFolder === "string") {
			settings.targetFolder = value.targetFolder;
		}

		if (isFilenameDisplayMode(value.filenameDisplayMode)) {
			settings.filenameDisplayMode = value.filenameDisplayMode;
		}

		return settings;
	}

	applyFilenameDisplayMode() {
		this.clearFilenameDisplayMode();

		if (this.settings.filenameDisplayMode === "hide") {
			document.body.classList.add(FILENAME_HIDE_CLASS);
		}

		if (this.settings.filenameDisplayMode === "hover") {
			document.body.classList.add(FILENAME_HOVER_CLASS);
		}
	}

	private clearFilenameDisplayMode() {
		document.body.classList.remove(FILENAME_HIDE_CLASS, FILENAME_HOVER_CLASS);
	}
}

class ImageAutoRenameSettingTab extends PluginSettingTab {
	plugin: ImageAutoRenamePlugin;

	constructor(app: App, plugin: ImageAutoRenamePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Default image folder")
			.setDesc("Folder used for newly created or pasted images. Leave empty to keep images in their original folder.")
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
			.setName("Image filename display")
			.setDesc("Controls whether Canvas image node file names are visible.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("show", "Show")
					.addOption("hide", "Hide")
					.addOption("hover", "Show on hover")
					.setValue(this.plugin.settings.filenameDisplayMode)
					.onChange(async (value) => {
						this.plugin.settings.filenameDisplayMode = value as FilenameDisplayMode;
						await this.plugin.saveSettings();
						this.plugin.applyFilenameDisplayMode();
					})
			);

		new Setting(containerEl)
			.setName("Rename images in current note")
			.setDesc("Check every embedded image in the currently open note and rename unprocessed images.")
			.addButton((button) =>
				button
					.setButtonText("Check and rename")
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText("Renaming...");

						try {
							await this.plugin.renameImagesInActiveNote();
						} finally {
							button.setDisabled(false);
							button.setButtonText("Check and rename");
						}
					})
			);
	}
}

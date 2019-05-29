import * as vscode from 'vscode';
import * as which from 'which';
import { buildAnnotationProvider, AnnotationProvider, Annotation } from './annotator';

class VSAnnotationProvider {
	context: vscode.ExtensionContext;
	rawProvider: AnnotationProvider;
	decorationsState: { [index: string]: [vscode.TextEditorDecorationType, vscode.Range][] } = {};

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.rawProvider = buildAnnotationProvider(vscode.workspace.getConfiguration("cython-annotate"));
	}

	createDecorations(annotation: Annotation) {
		const blueComponent = parseInt(annotation.scoreColorCode.slice(4, 6), 16);
		const opacity = (1 - (blueComponent / 256.)) / 2;
		const decorationOptions: vscode.DecorationRenderOptions = {
			//overviewRulerLane: vscode.OverviewRulerLane.Right,
			isWholeLine: true,
			backgroundColor: `rgba(128, 128, 0, ${opacity})`
			//backgroundColor: `rgba(128, 128, 256, ${opacity})`
		};
		return vscode.window.createTextEditorDecorationType(decorationOptions);
	}

	saveFileDecorations(sourcePath: string, decorations: [vscode.TextEditorDecorationType, vscode.Range][]) {
		this.decorationsState[sourcePath] = decorations;
	}

	setFileDecorations(activeEditor: vscode.TextEditor) {
		const sourcePath = activeEditor.document.fileName;
		const prevDecorations = this.decorationsState[sourcePath];
		if (prevDecorations) {
			for (let [decorations, range] of prevDecorations) {
				activeEditor.setDecorations(decorations, [range]);
			}
		}
	}
	clearFileDecorations(sourcePath: string) {
		const prevDecorations = this.decorationsState[sourcePath];
		if (prevDecorations) {
			for (let [decorations, range] of prevDecorations) {
				(<vscode.Disposable>decorations).dispose();
			}
		}
	}

	clearCurrentFileDecorations() {
		const editor = this.getEditorToAnnotate();
		if (editor) {
			this.clearFileDecorations(editor.document.fileName);
		}
	}

	clearAllFilesDecorations() {
		for (let filename in this.decorationsState) {
			this.clearFileDecorations(filename);
		}
	}

	getEditorToAnnotate(): vscode.TextEditor | undefined {
		let textEditor = vscode.window.activeTextEditor;
		if (textEditor === undefined) {
			vscode.window.showInformationMessage('No active editor');
			return;
		}
		if (textEditor.document.isDirty) {
			vscode.window.showInformationMessage('Changes must be saved for cython annotations');
			return;
		}
		if (textEditor.document.languageId !== 'cython') {
			vscode.window.showInformationMessage('Not a cython source file');
			return;
		}
		return textEditor;
	}


	isTrailingBlanksFrom(document: vscode.TextDocument, fromLine: number): boolean {
		for (let lineNum = fromLine; lineNum < document.lineCount; lineNum++) {
			if (!document.lineAt(lineNum).isEmptyOrWhitespace) {
				return false;
			}
		}
		return true;
	}

	// Do the whole thing
	annotate() {
		const activeEditor = this.getEditorToAnnotate();
		if (!activeEditor) { return; }

		const sourcePath = activeEditor.document.fileName;
		const annotations = this.rawProvider.annotate(sourcePath);

		// Sanity check - draw the annotations if the line count matches
		if (annotations.length !== activeEditor.document.lineCount &&
			!this.isTrailingBlanksFrom(activeEditor.document, annotations.length)) {
			vscode.window.showInformationMessage('Bad annotations html');
			return;
		}

		if (activeEditor === undefined) {
			return;
		}

		// Remove previous decorations
		this.clearFileDecorations(sourcePath);

		const fileDecorations: [vscode.TextEditorDecorationType, vscode.Range][] = [];
		annotations.forEach((annotation) => {
			const decorations = this.createDecorations(annotation);
			this.context.subscriptions.push(decorations);
			const range = new vscode.Range(annotation.lineNumber - 1, 0, annotation.lineNumber - 1, 0);
			fileDecorations.push([decorations, range]);
			activeEditor.setDecorations(decorations, [range]);
		});

		// Save the decorations so that we can either clear or redo them on editor change
		this.saveFileDecorations(sourcePath, fileDecorations);
		vscode.window.showInformationMessage(`Got ${annotations.length} annotations for ${sourcePath}`);
	}
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('"vscode-cython-annotate" is now active!');

	let annotator = new VSAnnotationProvider(context);
	context.subscriptions.push(vscode.commands.registerCommand('extension.cythonAnnotate', () => {
		annotator.annotate();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.cythonClearAnnotations', () => {
		annotator.clearCurrentFileDecorations();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.cythonClearAnnotationsAllFiles', () => {
		annotator.clearAllFilesDecorations();
	}));
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((activeEditor) => {
		if (!activeEditor) {
			return;
		}
		annotator.setFileDecorations(activeEditor);
	}));
}

// this method is called when your extension is deactivated
export function deactivate() { }

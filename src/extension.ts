import * as vscode from 'vscode';
import { buildAnnotationProvider, AnnotationProvider, Annotation } from './annotator';
import * as path from 'path';
import * as fs from 'fs';

class VSAnnotationProvider {
    context: vscode.ExtensionContext;
    rawProvider: AnnotationProvider;
    decorationsState: { [index: string]: [vscode.TextEditorDecorationType, vscode.DecorationOptions][] } = {};

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.rawProvider = buildAnnotationProvider(vscode.workspace.getConfiguration("cython-annotate"));
    }

    reloadConfig() {
        try {
            // Update provider
            const newProvider = buildAnnotationProvider(vscode.workspace.getConfiguration("cython-annotate"));
            this.rawProvider = newProvider;
        } catch (e) {
            // Do nothing. Probably an invalid configuration
        }
    }

    // Create the decoration object for the annotation
    createDecorations(annotation: Annotation) {
        const blueComponent = parseInt(annotation.scoreColorCode.slice(4, 6), 16);
        const opacity = (1 - (blueComponent / 256.)) / 2;
        const decorationOptions: vscode.DecorationRenderOptions = {
            isWholeLine: true,
            backgroundColor: `rgba(128, 128, 0, ${opacity})`,
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            overviewRulerColor: `rgba(128, 128, 0, ${opacity / 2})`

        };
        return vscode.window.createTextEditorDecorationType(decorationOptions);
    }

    // Save decorations into state
    saveFileDecorations(sourcePath: string,
                        decorations: [vscode.TextEditorDecorationType, vscode.DecorationOptions][]) {
        this.decorationsState[sourcePath] = decorations;
    }

    // Set decroations from state if available
    setFileDecorations(activeEditor: vscode.TextEditor) {
        const sourcePath = activeEditor.document.fileName;
        const prevDecorations = this.decorationsState[sourcePath];
        if (prevDecorations) {
            for (let [decorations, options] of prevDecorations) {
                activeEditor.setDecorations(decorations, [options]);
            }
        }
    }

    // Remove decorations for a certain file
    clearFileDecorations(sourcePath: string) {
        const prevDecorations = this.decorationsState[sourcePath];
        if (prevDecorations) {
            for (let [decorations, _] of prevDecorations) {
                (<vscode.Disposable>decorations).dispose();
            }
        }
    }

    // Clear decorations for the current editor
    clearCurrentFileDecorations() {
        const editor = this.getEditorToAnnotate();
        if (editor) {
            this.clearFileDecorations(editor.document.fileName);
        }
    }

    // Clear decorations for all files
    clearAllFilesDecorations() {
        for (let filename in this.decorationsState) {
            this.clearFileDecorations(filename);
        }
    }

    getEditorToAnnotate(): vscode.TextEditor | undefined {
        let textEditor = vscode.window.activeTextEditor;
        if (textEditor === undefined) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }
        if (textEditor.document.isDirty) {
            vscode.window.showErrorMessage('Changes must be saved for cython annotations');
            return;
        }
        if (textEditor.document.languageId !== 'cython') {
            vscode.window.showErrorMessage('Not a cython source file');
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

    annotateOrShowError(sourcePath: string): Annotation[] | null {
        try {
            return this.rawProvider.annotate(sourcePath);
        } catch (e) {
            vscode.window.showErrorMessage(
                `Got an error while annotating file "${sourcePath}"`,
                e.stderr.toString());
            return null;
        }
    }

    // Do the whole thing
    annotate() {
        const activeEditor = this.getEditorToAnnotate();
        if (!activeEditor) { return; }

        const sourcePath = activeEditor.document.fileName;
        const annotations = this.annotateOrShowError(sourcePath);
        if (annotations === null) {
            return;
        }

        // Sanity check - draw the annotations if the line count matches
        if (annotations.length !== activeEditor.document.lineCount &&
            !this.isTrailingBlanksFrom(activeEditor.document, annotations.length)) {
            vscode.window.showErrorMessage('Bad annotations html');
            return;
        }

        if (activeEditor === undefined) {
            return;
        }

        // Remove previous decorations
        this.clearFileDecorations(sourcePath);

        const fileDecorations: [vscode.TextEditorDecorationType, vscode.DecorationOptions][] = [];
        let totalScore = 0;
        annotations.forEach((annotation) => {
            const line = activeEditor.document.lineAt(annotation.lineNumber - 1);
            const decorations = this.createDecorations(annotation);
            this.context.subscriptions.push(decorations);
            const range = new vscode.Range(annotation.lineNumber - 1, 0, annotation.lineNumber - 1, line.text.length);
            let options: vscode.DecorationOptions = { range: range };
            const generatedCodeMarkdown = annotation.createGeneratedCodeMarkdown();
            if (generatedCodeMarkdown !== null) {
                options['hoverMessage'] = generatedCodeMarkdown;
            }
            fileDecorations.push([decorations, options]);
            activeEditor.setDecorations(decorations, [options]);
            totalScore += annotation.score;
        });

        // Save the decorations so that we can either clear or redo them on editor change
        this.saveFileDecorations(sourcePath, fileDecorations);
        vscode.window.showInformationMessage(`Score: ${totalScore} - Got ${annotations.length} annotations for ${sourcePath}`);
    }
}

// Switches between .pyx and corresponding .pxd declaration files
function switchHeaderSource() {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor === undefined) { return; }
    const filename = activeEditor.document.fileName;
    const srcExt = path.extname(filename);
    let dstExt;
    switch (srcExt) {
        case '.pyx':
            dstExt = '.pxd';
            break;
        case '.pxd':
            dstExt = '.pyx';
            break;
        default:
            return;
    }
    const dstPath = path.join(path.dirname(filename),
                              path.basename(filename, srcExt) + dstExt);
    if (!fs.existsSync(dstPath)) {
        return;
    }
    vscode.workspace.openTextDocument(dstPath).then((document) => {
        vscode.window.showTextDocument(document);
    });
}

// Activation handler
export function activate(context: vscode.ExtensionContext) {
    console.log('"vscode-cython-annotate" is now active!');

    let annotator = new VSAnnotationProvider(context);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {
        annotator.reloadConfig();
    }));
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
        if (!activeEditor) { return; }
        annotator.setFileDecorations(activeEditor);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('extension.cythonSwitchDeclarationSource', switchHeaderSource));
}

// Disactivation handler
export function deactivate() { }

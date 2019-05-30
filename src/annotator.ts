import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ChildProcess from 'child_process';
import * as cheerio from 'cheerio';

class Annotation {
    sourcePath: string;
    lineNumber: number;
    score: number;
    scoreColorCode: string;
    generatedCode: string | null;

    constructor(sourcePath: string, lineNumber: number,
                score: number, scoreColorCode: string,
                generatedCode: string | null) {
        this.sourcePath = sourcePath;
        this.lineNumber = lineNumber;
        this.score = score;
        this.scoreColorCode = scoreColorCode;
        this.generatedCode = generatedCode;
    }

    createGeneratedCodeMarkdown(): vscode.MarkdownString | null{
        if (this.generatedCode === null) {
            return null;
        }
        return new vscode.MarkdownString("```c\n" + this.generatedCode + "\n```");
    }
}

class CythonExecutor {
    condaEnv: string | undefined;
    constructor(condaEnv: string | undefined) {
        this.condaEnv = condaEnv;
    }
    run(args: string[]) {
        let cythonCmd;
        if (this.condaEnv) {
            cythonCmd = `. activate ${this.condaEnv} && cython -a ${args.join(' ')}`;
        } else {
            cythonCmd = `cython -a ${args.join(' ')}`;
        }

        ChildProcess.execFileSync(
            '/bin/bash', ['-c', cythonCmd]);
    }
}

class AnnotationProvider {
    cython: CythonExecutor;

    constructor(cython: CythonExecutor) {
        this.cython = cython;
    }

    executeCythonAnnotate(sourcePath: string): string {
        const environment = 'quiver';
        this.cython.run(['-a', sourcePath]);
        const annotationHtmlPath = path.join(
            path.dirname(sourcePath),
            path.basename(sourcePath, path.extname(sourcePath)) + '.html');

        return annotationHtmlPath;
    }

    scoreFromClass(class_id: string): number {
        return Number(class_id.slice('score-'.length));
    }

    parseScoreClassColorsCodes($: CheerioStatic): { [index: number]: string } {
        const result: { [index: number]: string } = {};
        const styleElementLines = $('style').text().split('\n');
        for (let line of styleElementLines) {
            if (!line.trimLeft().startsWith('.cython.score-')) {
                continue;
            }
            // Should look like ".cython.score-0 {background-color: #FFFFff;}"
            const tokens = line.trimLeft().split(' ');
            const score = this.scoreFromClass(tokens[0].slice('.cython.'.length));
            const colorCode = tokens[2].slice(1, 9);
            result[score] = colorCode;
        }
        return result;
    }

    parseAnnotationsHtml(sourcePath: string, annotationHtmlPath: string): Annotation[] {
        const result: Annotation[] = [];
        const data = fs.readFileSync(annotationHtmlPath);
        const $ = cheerio.load(data.toString('utf8'));
        const colorCodes = this.parseScoreClassColorsCodes($);

        $('.line').each((i: number, elem: CheerioElement) => {
            let lineNumberStr: string = $('span[class=""]', elem).text();
            let lineNumber: number = Number(lineNumberStr);
            if (lineNumber !== i + 1) {
                throw Error(`Error parsing line number in element: ${elem}`);
            }

            let elemClasses: string[] = elem.attribs['class'].split(' ');
            // Always the last one
            let scoreClass = elemClasses[elemClasses.length - 1];
            let lineScore = this.scoreFromClass(scoreClass);
            let code = null;
            if ($(elem).attr('onclick')) {
                code = $(elem).next('.code').text();
            }

            result.push(new Annotation(sourcePath, lineNumber, lineScore, colorCodes[lineScore], code));
        });

        return result;
    }

    annotate(sourcePath: string): Annotation[] {
        let annotationsHtmlPath = this.executeCythonAnnotate(sourcePath);
        return this.parseAnnotationsHtml(sourcePath, annotationsHtmlPath);
    }
}

function buildAnnotationProvider(configuration: vscode.WorkspaceConfiguration): AnnotationProvider {
    const executor = new CythonExecutor(configuration.get('condaEnv'));
    return new AnnotationProvider(executor);
}

export { AnnotationProvider, Annotation, buildAnnotationProvider };
import * as os from 'os';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ChildProcess from 'child_process';
import * as cheerio from 'cheerio';
import * as minimatch from 'minimatch';

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

    createGeneratedCodeMarkdown(): vscode.MarkdownString | null {
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
            let condaCmd;
            switch (os.platform()) {
                case 'darwin': /* falls through */
                case 'linux':
                    condaCmd = `. activate ${this.condaEnv}`;
                    break;
                case "win32":
                    condaCmd = `activate ${this.condaEnv}`;
                    break;
                default:
                    throw Error(`Unsupported operating system: ${os.platform()}`);
            }
            cythonCmd = `${condaCmd} && cython ${args.join(' ')}`;
        } else {
            cythonCmd = `cython ${args.join(' ')}`;
        }

        ChildProcess.execFileSync(
            '/bin/bash', ['-c', cythonCmd]);
    }
}

class AnnotationProvider {
    cython: CythonExecutor;
    cppPathMatchers: minimatch.IMinimatch[];

    constructor(cython: CythonExecutor, cppPaths: string[]) {
        this.cython = cython;
        this.cppPathMatchers = cppPaths.map(
            (path) => { return new minimatch.Minimatch(path); });
    }

    executeCythonAnnotate(sourcePath: string, isCpp: boolean): string {
        const environment = 'quiver';
        let args = ['-a', sourcePath];
        if (isCpp) {
            args.unshift('--cplus');
        }
        this.cython.run(args);
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

    isCppPath(path: string): boolean {
        for (let matcher of this.cppPathMatchers) {
            if (matcher.match(path)) {
                return true;
            }
        }
        return false;
    }

    annotate(sourcePath: string): Annotation[] {
        let annotationsHtmlPath = this.executeCythonAnnotate(sourcePath, this.isCppPath(sourcePath));
        return this.parseAnnotationsHtml(sourcePath, annotationsHtmlPath);
    }
}

function buildAnnotationProvider(configuration: vscode.WorkspaceConfiguration): AnnotationProvider {
    let cppPaths = configuration.get('cppPaths', []);
    const executor = new CythonExecutor(configuration.get('condaEnv'));
    return new AnnotationProvider(executor, cppPaths);
}

export { AnnotationProvider, Annotation, buildAnnotationProvider };
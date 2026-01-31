#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { MarkdownConverter } from './converter.js';

const program = new Command();
const converter = new MarkdownConverter();

// Load template
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const templatePath = path.join(__dirname, 'assets', 'template.html');
let templateContent;
try {
    templateContent = await fs.readFile(templatePath, 'utf-8');
    converter.setTemplate(templateContent);
} catch (err) {
    console.error(chalk.red(`Error loading template from ${templatePath}:`), err);
    process.exit(1);
}

// Helper to strip numeric prefix from a single path segment
function cleanSegment(segment) {
    return segment.replace(/^\d+\.?\s*/, '');
}

// Helper to clean an entire relative path
function getCleanPath(filePath) {
    return filePath.split(path.sep).map(cleanSegment).join(path.sep);
}

// Helper to prune titles for navigation (e.g., "01.Welcome Zed" -> "Welcome")
function pruneTitle(title) {
    if (!title) return title;
    // Remove numeric prefixes like "01.", "1.", etc.
    let cleaned = cleanSegment(title);
    // Remove trailing " Zed" suffix
    return cleaned.replace(/\s+Zed$/i, '').trim();
}

// Helper to get title from frontmatter
async function getFileTitle(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
        const match = content.match(frontmatterRegex);
        let body = content;

        if (match) {
            const data = yaml.load(match[1]);
            if (data && data.title) return pruneTitle(data.title);
            body = content.replace(frontmatterRegex, '');
        }

        // Fallback to first H1
        const headerMatch = body.match(/^#\s+(.+)$/m);
        if (headerMatch) return pruneTitle(headerMatch[1]);
    } catch (e) {
        // Ignore errors
    }
    return null;
}

// Build hierarchical file tree
async function buildFileTree(files, inputDir) {
    const tree = {};
    for (const file of files) {
        const parts = file.split(path.sep);
        const cleanFile = getCleanPath(file);
        let current = tree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                const title = await getFileTitle(path.join(inputDir, file));
                current[part] = {
                    type: 'file',
                    fullRelativePath: file,
                    cleanRelativePath: cleanFile,
                    title
                };
            } else {
                if (!current[part]) {
                    current[part] = {
                        type: 'directory',
                        children: {},
                        cleanRelativePath: getCleanPath(parts.slice(0, i + 1).join(path.sep))
                    };
                }
                current = current[part].children;
            }
        }
    }

    // Identify indexFiles for directories
    // (index.md or a file named after the folder takes precedence)
    function findIndexFiles(nodes) {
        for (const [name, node] of Object.entries(nodes)) {
            if (node.type === 'directory') {
                findIndexFiles(node.children);

                const cleanName = cleanSegment(name);

                // Find index.md or [folderName].md
                let indexNode = null;
                let indexKey = null;

                for (const [childName, childNode] of Object.entries(node.children)) {
                    if (childNode.type === 'file') {
                        const cleanChildName = cleanSegment(childName);
                        if (cleanChildName === 'index.md' || cleanChildName === `${cleanName}.md`) {
                            indexNode = childNode;
                            indexKey = childName;
                            break;
                        }
                    }
                }

                if (indexNode) {
                    node.indexFile = indexNode;
                    delete node.children[indexKey];
                }
            }
        }
    }

    findIndexFiles(tree);
    return tree;
}

// Helper to find the first logical file in the tree (honoring numeric sorting)
function findFirstFile(tree) {
    const flat = flattenFileTree(tree);
    return flat.length > 0 ? flat[0] : null;
}

// Flatten the sorted tree into a sequence of pages
function flattenFileTree(tree) {
    let flat = [];
    const entries = Object.entries(tree).sort(([a, nodeA], [b, nodeB]) => {
        const numA = parseInt(a.match(/^(\d+)/)?.[1]);
        const numB = parseInt(b.match(/^(\d+)/)?.[1]);
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
        if (nodeA.type !== nodeB.type) return nodeA.type === 'directory' ? -1 : 1;
        return a.localeCompare(b);
    });

    for (const [name, node] of entries) {
        if (node.type === 'directory') {
            if (node.indexFile) flat.push(node.indexFile);
            if (node.children) flat = flat.concat(flattenFileTree(node.children));
        } else {
            flat.push(node);
        }
    }
    return flat;
}

program
    .name('mdex')
    .description('A premium CLI tool to convert Markdown files to static HTML documentation.')
    .version('1.0.0')
    .option('-i, --input <dir>', 'Input directory containing .md files', '.')
    .option('-o, --output <dir>', 'Output directory for HTML files', 'dist')
    .option('-t, --theme <name>', 'Theme to use (modern, dark, midnight)', 'modern')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .action(async (options) => {
        const inputDir = path.resolve(options.input);
        const outputDir = path.resolve(options.output);
        const theme = options.theme || 'modern';

        console.log(chalk.bold.blue('🚀 Starting Markdown Export...'));
        console.log(chalk.gray(`Input:  ${inputDir}`));
        console.log(chalk.gray(`Output: ${outputDir}\n`));

        try {
            const files = await glob('**/*.md', {
                cwd: inputDir,
                ignore: ['node_modules/**', 'dist/**', '.git/**'],
                absolute: false
            });

            if (files.length === 0) {
                console.log(chalk.yellow('⚠️ No Markdown files found in the input directory.'));
                return;
            }

            // --- Custom Header/Footer Processing ---
            let customHeader = null;
            let customFooter = null;

            const headerPath = path.join(inputDir, 'header.md');
            const footerPath = path.join(inputDir, 'footer.md');

            if (await fs.pathExists(headerPath)) {
                if (options.verbose) console.log(chalk.gray('Found custom header.md'));
                const headerContent = await fs.readFile(headerPath, 'utf-8');
                customHeader = converter.md.render(headerContent);
            }

            if (await fs.pathExists(footerPath)) {
                if (options.verbose) console.log(chalk.gray('Found custom footer.md'));
                const footerContent = await fs.readFile(footerPath, 'utf-8');
                customFooter = converter.md.render(footerContent);
            }

            // Exclude header.md/footer.md from standard processing
            const docFiles = files.filter(f => f !== 'header.md' && f !== 'footer.md');

            // Scan available themes
            const __dirname = path.dirname(new URL(import.meta.url).pathname);
            const themesDir = path.join(__dirname, 'assets', 'themes');
            const availableThemes = (await fs.readdir(themesDir))
                .filter(file => file.endsWith('.css'))
                .map(file => file.replace('.css', ''));

            if (!availableThemes.includes(theme)) {
                throw new Error(`Theme '${theme}' not found. Available themes: ${availableThemes.join(', ')}`);
            }

            console.log(chalk.cyan(`Building navigation tree...`));
            const fileTree = await buildFileTree(docFiles, inputDir);

            console.log(chalk.cyan(`Converting ${docFiles.length} markdown file(s)...`));

            const flatTree = flattenFileTree(fileTree);

            for (const file of docFiles) {
                const filePath = path.join(inputDir, file);
                const content = await fs.readFile(filePath, 'utf-8');

                const cleanRelPath = getCleanPath(file);
                const outputFilePath = path.join(outputDir, cleanRelPath.replace(/\.md$/, '.html'));

                // Find current node and neighbors for pagination
                const currentIndex = flatTree.findIndex(n => n.fullRelativePath === file);
                const prev = currentIndex > 0 ? flatTree[currentIndex - 1] : null;
                const next = currentIndex < flatTree.length - 1 ? flatTree[currentIndex + 1] : null;

                // Calculate relative level for clean paths
                const depth = cleanRelPath.split(path.sep).length - 1;
                const relativeLevel = depth === 0 ? './' : '../'.repeat(depth);

                if (options.verbose) {
                    console.log(chalk.gray(`Processing: ${file} -> ${path.relative(outputDir, outputFilePath)}`));
                }

                const html = converter.convert(content, file, fileTree, file, relativeLevel, prev, next, customHeader, customFooter, theme, availableThemes);

                await fs.ensureDir(path.dirname(outputFilePath));
                await fs.writeFile(outputFilePath, html);
            }

            console.log(chalk.green.bold('\n✨ Export completed successfully!'));

            // --- Ensure root index.html exists and is up to date ---
            const rootIndexDest = path.join(outputDir, 'index.html');
            const firstNode = findFirstFile(fileTree);

            if (firstNode) {
                if (options.verbose) console.log(chalk.gray('Updating root index.html from first page...'));
                const content = await fs.readFile(path.join(inputDir, firstNode.fullRelativePath), 'utf-8');
                const html = converter.convert(content, firstNode.fullRelativePath, fileTree, firstNode.fullRelativePath, './', null, null, customHeader, customFooter, theme, availableThemes);
                await fs.writeFile(rootIndexDest, html);
                console.log(chalk.green(`Homepage synchronized from: ${firstNode.fullRelativePath}`));
            }

            // Copy assets (CSS, JS, Fonts) to output directory
            const themesDest = path.join(outputDir, 'assets', 'themes');
            const jsSrc = path.join(__dirname, 'assets', 'script.js');
            const jsDest = path.join(outputDir, 'assets', 'script.js');

            await fs.ensureDir(path.join(outputDir, 'assets'));
            await fs.copy(themesDir, themesDest);
            await fs.copy(jsSrc, jsDest);

            console.log(chalk.blue(`View your site in: ${outputDir}`));

        } catch (error) {
            console.error(chalk.red.bold('\n❌ Error during export:'), error.message);
            if (options.verbose) console.error(error);
        }
    });

program.parse(process.argv);

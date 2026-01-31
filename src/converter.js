import markdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import hljs from 'highlight.js';
import yaml from 'js-yaml';
import path from 'path';

/**
 * Class responsible for converting Markdown content to HTML with custom extensions.
 */
export class MarkdownConverter {
    /**
     * Converts a string into a URL-friendly slug.
     * Handles Vietnamese accents by normalizing to NFD and removing diacritics.
     *
     * @param {string} s - The string to slugify.
     * @returns {string} The slugified string.
     */
    slugify(s) {
        return s
            .normalize('NFD') // Normalize to NFD form (decomposes accents)
            .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
            .replace(/đ/g, 'd').replace(/Đ/g, 'D') // Handle distinct Vietnamese characters
            .toLowerCase() // Convert to lowercase
            .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric chars (keep spaces/hyphens)
            .trim() // Remove leading/trailing spaces
            .replace(/\s+/g, '-'); // Replace spaces with hyphens
    }

    /**
     * Initializes the MarkdownConverter with markdown-it plugins and custom configurations.
     */
    constructor() {
        this.md = markdownIt({
            html: true,
            linkify: true,
            typographer: true,
            highlight: (str, lang) => {
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        return '<pre class="hljs"><code>' +
                            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                            '</code></pre>';
                    } catch (__) { }
                }
                return '<pre class="hljs"><code>' + this.md.utils.escapeHtml(str) + '</code></pre>';
            }
        }).use(anchor, {
            slugify: (s) => this.slugify(s)
        });

        // Custom fence renderer for Mermaid.js
        const defaultFence = this.md.renderer.rules.fence || function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
        };

        this.md.renderer.rules.fence = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            const info = token.info ? this.md.utils.unescapeAll(token.info).trim() : '';

            if (info === 'mermaid') {
                return `<div class="mermaid">${token.content}</div>`;
            }

            return defaultFence(tokens, idx, options, env, self);
        };
    }

    /**
     * Parses the YAML frontmatter from the markdown content.
     *
     * @param {string} content - The raw markdown content.
     * @returns {{data: Object, body: string}} An object containing the parsed frontmatter data and the body content.
     */
    parseFrontmatter(content) {
        const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
        const match = content.match(frontmatterRegex);
        if (match) {
            try {
                const data = yaml.load(match[1]);
                const body = content.replace(frontmatterRegex, '');
                return { data, body };
            } catch (e) {
                console.error('Error parsing frontmatter:', e);
            }
        }
        return { data: {}, body: content };
    }

    /**
     * Extracts the Table of Contents (TOC) from the markdown body.
     * Generates IDs using the same slugify logic as the renderer.
     *
     * @param {string} body - The markdown body content.
     * @returns {Array<{level: string, title: string, id: string}>} An array of TOC items.
     */
    extractTOC(body) {
        const tokens = this.md.parse(body, {});
        const toc = [];
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type === 'heading_open' && (tokens[i].tag === 'h2' || tokens[i].tag === 'h3')) {
                const title = tokens[i + 1].children
                    .filter(c => c.type === 'text' || c.type === 'code_inline')
                    .map(c => c.content)
                    .join('');

                // Find ID attribute from tokens
                const idAttr = tokens[i].attrs && tokens[i].attrs.find(attr => attr[0] === 'id');
                const id = idAttr ? idAttr[1] : this.slugify(title);

                toc.push({ level: tokens[i].tag, title, id });
            }
        }
        return toc;
    }
    
    /**
     * helper to find the first valid link (child file) for a directory node.
     *
     * @param {Object} node - The directory node in the file tree.
     * @returns {string|null} The relative path to the first child's HTML file, or null if empty.
     */
    getFirstChildHref(node) {
        if (!node.children || Object.keys(node.children).length === 0) return null;

        const sortedChildren = Object.entries(node.children).sort(([a, nodeA], [b, nodeB]) => {
            const numA = parseInt(a.match(/^(\d+)/)?.[1]);
            const numB = parseInt(b.match(/^(\d+)/)?.[1]);
            if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
            if (nodeA.type !== nodeB.type) return nodeA.type === 'directory' ? -1 : 1;
            return a.localeCompare(b);
        });

        const [firstKey, firstNode] = sortedChildren[0];

        if (firstNode.type === 'file') {
            return firstNode.cleanRelativePath.replace(/\.md$/, '.html');
        } else {
            // Directory: check for indexFile, or recurse
            if (firstNode.indexFile) {
                return firstNode.indexFile.cleanRelativePath.replace(/\.md$/, '.html');
            }
            return this.getFirstChildHref(firstNode);
        }
    }


    /**
     * Checks if a node or any of its descendants matches the current path.
     * Used for expanding the sidebar navigation.
     *
     * @param {Object} node - The file tree node.
     * @param {string} currentPath - The full relative path of the current page.
     * @returns {boolean} True if the node is active or has an active descendant.
     */
    isDescendantActive(node, currentPath) {
        if (node.type === 'file') {
            return node.fullRelativePath === currentPath;
        }
        if (node.indexFile && node.indexFile.fullRelativePath === currentPath) {
            return true;
        }
        if (node.children) {
            return Object.values(node.children).some(child => this.isDescendantActive(child, currentPath));
        }
        return false;
    }

    /**
     * Renders the recursive file tree as an HTML list for the sidebar.
     *
     * @param {Object} tree - The file tree structure.
     * @param {string} currentPath - The current file path (for highlighting active items).
     * @param {string} relativeLevel - relative path prefix to root.
     * @param {number} [depth=0] - Current recursion depth.
     * @returns {string} The rendered HTML string.
     */
    renderFileTree(tree, currentPath, relativeLevel, depth = 0) {
        let html = '<ul>';
        const entries = Object.entries(tree).sort(([a, nodeA], [b, nodeB]) => {
            // Numeric prefix sorting (e.g., "01.welcome")
            const numA = parseInt(a.match(/^(\d+)/)?.[1]);
            const numB = parseInt(b.match(/^(\d+)/)?.[1]);

            if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
                return numA - numB;
            }

            // If no numbers or numbers are equal, then sort by type (directories first)
            if (nodeA.type !== nodeB.type) {
                return nodeA.type === 'directory' ? -1 : 1;
            }

            return a.localeCompare(b);
        });

        const padding = 1.5 + (depth * 1.25);

        for (const [name, node] of entries) {
            // Prune numeric prefix from label (e.g., "01.welcome" -> "welcome")
            const cleanLabel = name.replace(/^\d+\.?\s*/, '');

            if (node.type === 'file') {
                const isActive = node.fullRelativePath === currentPath;
                const href = path.join(relativeLevel, node.cleanRelativePath.replace(/\.md$/, '.html'));
                const label = node.title || cleanLabel.replace(/\.md$/, '');
                html += `<li class="${isActive ? 'active' : ''}"><a href="${href}" class="block py-1.5 pr-2 text-[0.9rem] text-zinc-400 hover:text-zinc-100 transition-colors truncate ${isActive ? 'text-blue-400 font-medium' : ''}" style="padding-left: ${padding}rem">${label}</a></li>`;
            } else {
                // Directory
                const hasIndex = !!node.indexFile;
                const isActive = hasIndex && node.indexFile.fullRelativePath === currentPath;

                // Use H1 title from index file if available, otherwise fallback to capitalized folder name
                let label = cleanLabel.charAt(0).toUpperCase() + cleanLabel.slice(1);
                if (hasIndex && node.indexFile.title) {
                    label = node.indexFile.title;
                }

                const isExpanded = isActive || this.isDescendantActive(node, currentPath);

                html += `<li class="${node.children ? 'has-children' : ''} ${isActive ? 'active' : ''} ${isExpanded ? 'expanded' : ''}">`;

                let href = null;
                if (hasIndex) {
                    href = path.join(relativeLevel, node.indexFile.cleanRelativePath.replace(/\.md$/, '.html'));
                } else {
                    // Auto-link to first child
                    const childHref = this.getFirstChildHref(node);
                    if (childHref) {
                        href = path.join(relativeLevel, childHref);
                    }
                }

                const isActiveFolder = isActive || isExpanded;
                html += `<div class="folder-row" style="padding-left: ${padding - 1.5}rem">`;
                if (href) {
                    html += `<a href="${href}" class="folder-link">${label}</a>`;
                } else {
                    html += `<span class="folder">${label}</span>`;
                }

                if (node.children && Object.keys(node.children).length > 0) {
                    html += `<span class="chevron"></span>`;
                }
                html += `</div>`;

                if (node.children && Object.keys(node.children).length > 0) {
                    html += this.renderFileTree(node.children, currentPath, relativeLevel, depth + 1);
                }
                html += '</li>';
            }
        }
        html += '</ul>';
        return html;
    }

    /**
     * Main conversion method.
     * Parses frontmatter, renders markdown, extracts TOC, and wraps in template.
     *
     * @param {string} content - Raw markdown content.
     * @param {string} fileName - Name of the source file.
     * @param {Object} fileTree - Complete file tree for navigation.
     * @param {string} currentPath - Relative path of the current file.
     * @param {string} [relativeLevel=''] - Relative path to root (e.g. "../").
     * @param {Object|null} [prev=null] - Previous page node for pagination.
     * @param {Object|null} [next=null] - Next page node for pagination.
     * @param {string|null} [customHeader=null] - Rendered HTML for custom header.
     * @param {string|null} [customFooter=null] - Rendered HTML for custom footer.
     * @param {string} [theme='modern'] - The selected theme.
     * @param {Array<string>} [availableThemes=[]] - List of available themes.
     * @returns {string} The complete HTML page.
     */
    convert(content, fileName, fileTree, currentPath, relativeLevel = '', prev = null, next = null, customHeader = null, customFooter = null, theme = 'modern', availableThemes = []) {
        const { data, body } = this.parseFrontmatter(content);
        let title = data.title;
        let finalBody = body;

        // Extract title from body if not in frontmatter
        const headerMatch = body.match(/^#\s+(.+)$/m);
        if (!title && headerMatch) {
            title = headerMatch[1].trim();
        }

        // If we have a title (from frontmatter or H1) and it matches the first H1, 
        // we strip it from the body because we'll render it in the template's header.
        if (title && headerMatch && headerMatch[1].trim() === title) {
            finalBody = body.replace(/^#\s+.+$/m, '').trim();
        }

        if (!title) title = fileName.replace(/\.md$/, '');

        const htmlContent = this.md.render(finalBody);
        const toc = this.extractTOC(finalBody); // Extract TOC from the body WITHOUT the main title
        const pageTitle = title;

        return this.wrapWithTemplate(htmlContent, pageTitle, data, toc, fileTree, currentPath, relativeLevel, prev, next, customHeader, customFooter, theme, availableThemes);
    }

    /**
     * Loading logic for template.
     * Currently a placeholder as loading is handled in index.js.
     */
    loadTemplate() {
        if (!this.template) {
            const __dirname = path.dirname(new URL(import.meta.url).pathname);
            const templatePath = path.join(__dirname, 'assets', 'template.html');
            // Logic handled in index.js to pass templateContent
        }
    }

    /**
     * Sets the raw template content.
     * @param {string} templateContent - HTML string of the template.
     */
    setTemplate(templateContent) {
        this.templateContent = templateContent;
    }

    /**
     * Wraps the rendered markdown content with the HTML template.
     * Performs string replacement for template variables.
     *
     * @param {string} content - Rendered HTML content of the markdown body.
     * @param {string} title - Page title.
     * @param {Object} data - Frontmatter data.
     * @param {Array} toc - Table of Contents array.
     * @param {Object} fileTree - File tree for sidebar.
     * @param {string} currentPath - Current file path.
     * @param {string} relativeLevel - Relative path to root.
     * @param {Object} prev - Previous page object.
     * @param {Object} next - Next page object.
     * @param {string} customHeader - HTML for header.
     * @param {string} customFooter - HTML for footer.
     * @param {string} theme - Theme name.
     * @param {Array} availableThemes - Available themes.
     * @returns {string} Final HTML string.
     */
    wrapWithTemplate(content, title, data, toc, fileTree, currentPath, relativeLevel, prev, next, customHeader, customFooter, theme, availableThemes) {
        const sidebarHtml = this.renderFileTree(fileTree, currentPath, relativeLevel);
        const tocHtml = toc.length > 0
            ? `<ul>${toc.map(item => `<li class="toc-${item.level}"><a href="#${item.id}">${item.title}</a></li>`).join('')}</ul>`
            : '<p class="no-toc">No sections found</p>';

        const prevHtml = prev ? `
            <a href="${path.join(relativeLevel, prev.cleanRelativePath.replace(/\.md$/, '.html'))}" class="pagination-link prev">
                <span class="pagination-label">Previous</span>
                <span class="pagination-title">${prev.title || prev.cleanRelativePath.split('/').pop().replace('.md', '')}</span>
            </a>
        ` : '<div></div>';

        const nextHtml = next ? `
            <a href="${path.join(relativeLevel, next.cleanRelativePath.replace(/\.md$/, '.html'))}" class="pagination-link next">
                <span class="pagination-label">Next</span>
                <span class="pagination-title">${next.title || next.cleanRelativePath.split('/').pop().replace('.md', '')}</span>
            </a>
        ` : '<div></div>';


        const mermaidTheme = theme === 'dark' || theme === 'midnight' || theme === 'zed' ? 'dark' : 'default';

        let template = this.templateContent;
        if (!template) {
            return 'Error: Template not loaded.';
        }

        // naive replacement
        return template
            .replace(/{{title}}/g, title)
            .replace(/{{relativeLevel}}/g, relativeLevel)
            .replace(/{{customHeader}}/g, customHeader || (customHeader === '' ? '' : '<h3>Documentation</h3>'))
            .replace(/{{sidebar}}/g, sidebarHtml)
            .replace(/{{meta_date}}/g, data.date ? `<div class="meta">${new Date(data.date).toLocaleDateString()}</div>` : '')
            .replace(/{{pageTitle}}/g, title)
            .replace(/{{meta_description}}/g, data.description ? `<p class="description">${data.description}</p>` : '')
            .replace(/{{content}}/g, content)
            .replace(/{{prevLink}}/g, prevHtml)
            .replace(/{{nextLink}}/g, nextHtml)
            .replace(/{{customFooter}}/g, customFooter ? `<div class="custom-footer">${customFooter}</div>` : '')
            .replace(/{{buildDate}}/g, new Date().toLocaleDateString())
            .replace(/{{toc}}/g, tocHtml)
            .replace(/{{theme}}/g, theme)
            .replace(/{{mermaidTheme}}/g, mermaidTheme)
    }
}

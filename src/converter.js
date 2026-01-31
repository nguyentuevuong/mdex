import markdownIt from "markdown-it";
import hljs from "highlight.js";
import anchor from "markdown-it-anchor";
import path from "path";
import yaml from "js-yaml";

// Khởi tạo markdown-it
const md = markdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const { value } = hljs.highlight(str, {
          language: lang,
          ignoreIllegals: true,
        });

        return `<pre class="hljs">${value}</pre>`;
      } catch (__) {}
    }

    const escapeHtml = md.utils.escapeHtml(str);

    if (lang === "mermaid") {
      return `<pre class='mermaid'>${escapeHtml}</pre>`;
    }

    return `<pre class="hljs">${escapeHtml}</pre>`;
  },
}).use(anchor, {
  slugify: slugify,
});

/**
 * Slugifies a string into a URL-friendly version.
 *
 * @param {string} s - The string to slugify.
 * @returns {string} The slugified string.
 */
function slugify(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Parses the YAML header of a Markdown file.
 * @param {string} content - The content of the Markdown file.
 * @returns {object} An object containing the parsed data and body.
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = content.match(frontmatterRegex);
  if (match) {
    try {
      const data = yaml.load(match[1]);
      const body = content.replace(frontmatterRegex, "");
      return { data, body };
    } catch (e) {
      console.error("Error parsing frontmatter:", e);
    }
  }
  return { data: {}, body: content };
}

// Extract TOC
function extractTOC(body) {
  const tokens = md.parse(body, {});
  const toc = [];
  for (let i = 0; i < tokens.length; i++) {
    if (
      tokens[i].type === "heading_open" &&
      (tokens[i].tag === "h2" || tokens[i].tag === "h3")
    ) {
      const title = tokens[i + 1].children
        .filter((c) => c.type === "text" || c.type === "code_inline")
        .map((c) => c.content)
        .join("");

      const idAttr =
        tokens[i].attrs && tokens[i].attrs.find((attr) => attr[0] === "id");
      const id = idAttr ? idAttr[1] : slugify(title);

      toc.push({ level: tokens[i].tag, title, id });
    }
  }
  return toc;
}

/**
 * Finds the first child href of a node.
 * @param {object} node - The node to search.
 * @returns {string|null} The first child href or null if not found.
 */
function getFirstChildHref(node) {
  if (!node.children || Object.keys(node.children).length === 0) return null;

  const sortedChildren = Object.entries(node.children).sort(
    ([a, nodeA], [b, nodeB]) => {
      const numA = parseInt(a.match(/^(\d+)/)?.[1]);
      const numB = parseInt(b.match(/^(\d+)/)?.[1]);
      if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
      if (nodeA.type !== nodeB.type) return nodeA.type === "directory" ? -1 : 1;
      return a.localeCompare(b);
    },
  );

  const [firstKey, firstNode] = sortedChildren[0];

  if (firstNode.type === "file") {
    return firstNode.cleanRelativePath.replace(/\.md$/, ".html");
  } else {
    if (firstNode.indexFile) {
      return firstNode.indexFile.cleanRelativePath.replace(/\.md$/, ".html");
    }
    return getFirstChildHref(firstNode);
  }
}

/**
 * Checks if a descendant node is active.
 *
 * @param {object} node - The node to check.
 * @param {string} currentPath - The current path.
 * @returns {boolean} Whether the descendant node is active.
 */
function isDescendantActive(node, currentPath) {
  if (node.type === "file") {
    return node.fullRelativePath === currentPath;
  }
  if (node.indexFile && node.indexFile.fullRelativePath === currentPath) {
    return true;
  }
  if (node.children) {
    return Object.values(node.children).some((child) =>
      isDescendantActive(child, currentPath),
    );
  }
  return false;
}

/**
 * Renders the file tree HTML from a tree object.
 *
 * @param {object} tree - The file tree object.
 * @param {string} currentPath - The current path.
 * @param {string} relativeLevel - The relative level.
 * @param {number} depth - The depth of the file tree.
 * @returns {string} The HTML of the file tree.
 */
function renderFileTree(tree, currentPath, relativeLevel, depth = 0) {
  let html = "<ul>";
  const entries = Object.entries(tree).sort(([a, nodeA], [b, nodeB]) => {
    const numA = parseInt(a.match(/^(\d+)/)?.[1]);
    const numB = parseInt(b.match(/^(\d+)/)?.[1]);

    if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
      return numA - numB;
    }

    if (nodeA.type !== nodeB.type) {
      return nodeA.type === "directory" ? -1 : 1;
    }

    return a.localeCompare(b);
  });

  const padding = 1.5 + depth * 1.25;

  for (const [name, node] of entries) {
    const cleanLabel = name.replace(/^\d+\.?\s*/, "");

    if (node.type === "file") {
      const isActive = node.fullRelativePath === currentPath;
      const href = path.join(
        relativeLevel,
        node.cleanRelativePath.replace(/\.md$/, ".html"),
      );
      const label = node.title || cleanLabel.replace(/\.md$/, "");
      html += `<li class="${isActive ? "active" : ""}"><a href="${href}" class="block py-1.5 pr-2 text-[0.9rem] text-zinc-400 hover:text-zinc-100 transition-colors truncate ${isActive ? "text-blue-400 font-medium" : ""}" style="padding-left: ${padding}rem">${label}</a></li>`;
    } else {
      const hasIndex = !!node.indexFile;
      const isActive =
        hasIndex && node.indexFile.fullRelativePath === currentPath;

      let label = cleanLabel.charAt(0).toUpperCase() + cleanLabel.slice(1);
      if (hasIndex && node.indexFile.title) {
        label = node.indexFile.title;
      }

      const isExpanded = isActive || isDescendantActive(node, currentPath);

      html += `<li class="${node.children ? "has-children" : ""} ${isActive ? "active" : ""} ${isExpanded ? "expanded" : ""}">`;

      let href = null;
      if (hasIndex) {
        href = path.join(
          relativeLevel,
          node.indexFile.cleanRelativePath.replace(/\.md$/, ".html"),
        );
      } else {
        const childHref = getFirstChildHref(node);
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
        html += renderFileTree(
          node.children,
          currentPath,
          relativeLevel,
          depth + 1,
        );
      }
      html += "</li>";
    }
  }
  html += "</ul>";
  return html;
}

/**
 * Converts a Markdown file to HTML.
 *
 * @param {string} content - The content of the Markdown file.
 * @param {string} fileName - The name of the Markdown file.
 * @param {object} fileTree - The file tree object.
 * @param {string} currentPath - The current path.
 * @param {string} relativeLevel - The relative level.
 * @param {object|null} prev - The previous file.
 * @param {object|null} next - The next file.
 * @param {string|null} customHeader - The custom header.
 * @param {string|null} customFooter - The custom footer.
 * @returns {string} The HTML of the converted Markdown file.
 */
function convert(
  content,
  fileName,
  fileTree,
  currentPath,
  relativeLevel = "",
  prev = null,
  next = null,
  customHeader = null,
  customFooter = null,
) {
  const { data, body } = parseFrontmatter(content);
  let title = data.title;
  let finalBody = body;

  const headerMatch = body.match(/^#\s+(.+)$/m);
  if (!title && headerMatch) {
    title = headerMatch[1].trim();
  }

  if (title && headerMatch && headerMatch[1].trim() === title) {
    finalBody = body.replace(/^#\s+.+$/m, "").trim();
  }

  if (!title) title = fileName.replace(/\.md$/, "");

  const htmlContent = md.render(finalBody);
  const toc = extractTOC(finalBody);
  const pageTitle = title;

  return wrapWithTemplate(
    htmlContent,
    pageTitle,
    data,
    toc,
    fileTree,
    currentPath,
    relativeLevel,
    prev,
    next,
    customHeader,
    customFooter,
  );
}

// Template variable
let templateContent = "";

/**
 * Sets the template content.
 * @param {string} template - The template content.
 */
function setTemplateContent(template) {
  templateContent = template;
}

/**
 * Wraps the content with the template.
 *
 * @param {string} content - The content to wrap.
 * @param {string} title - The title of the page.
 * @param {object} data - The frontmatter data.
 * @param {object[]} toc - The table of contents.
 * @param {object} fileTree - The file tree object.
 * @param {string} currentPath - The current path.
 * @param {string} relativeLevel - The relative level.
 * @param {object|null} prev - The previous file.
 * @param {object|null} next - The next file.
 * @param {string|null} customHeader - The custom header.
 * @param {string|null} customFooter - The custom footer.
 * @returns {string} The wrapped HTML.
 */
function wrapWithTemplate(
  content,
  title,
  data,
  toc,
  fileTree,
  currentPath,
  relativeLevel,
  prev,
  next,
  customHeader,
  customFooter,
) {
  const sidebarHtml = renderFileTree(fileTree, currentPath, relativeLevel);
  const tocHtml =
    toc.length > 0
      ? `<ul>${toc.map((item) => `<li class="toc-${item.level}"><a href="#${item.id}">${item.title}</a></li>`).join("")}</ul>`
      : '<p class="no-toc">No sections found</p>';

  const prevHtml = prev
    ? `
    <a href="${path.join(relativeLevel, prev.cleanRelativePath.replace(/\.md$/, ".html"))}" class="pagination-link prev">
      <span class="pagination-label">Previous</span>
      <span class="pagination-title">${prev.title || prev.cleanRelativePath.split("/").pop().replace(".md", "")}</span>
    </a>
  `
    : "<div></div>";

  const nextHtml = next
    ? `
    <a href="${path.join(relativeLevel, next.cleanRelativePath.replace(/\.md$/, ".html"))}" class="pagination-link next">
      <span class="pagination-label">Next</span>
      <span class="pagination-title">${next.title || next.cleanRelativePath.split("/").pop().replace(".md", "")}</span>
    </a>
  `
    : "<div></div>";

  if (!templateContent) {
    return "Error: Template not loaded.";
  }

  return templateContent
    .replace(/{{title}}/g, title)
    .replace(/{{relativeLevel}}/g, relativeLevel)
    .replace(
      /{{customHeader}}/g,
      customHeader || (customHeader === "" ? "" : "<h3>Documentation</h3>"),
    )
    .replace(/{{sidebar}}/g, sidebarHtml)
    .replace(
      /{{meta_date}}/g,
      data.date
        ? `<div class="meta">${new Date(data.date).toLocaleDateString()}</div>`
        : "",
    )
    .replace(/{{pageTitle}}/g, title)
    .replace(
      /{{meta_description}}/g,
      data.description ? `<p class="description">${data.description}</p>` : "",
    )
    .replace(/{{content}}/g, content)
    .replace(/{{prevLink}}/g, prevHtml)
    .replace(/{{nextLink}}/g, nextHtml)
    .replace(
      /{{customFooter}}/g,
      customFooter ? `<div class="custom-footer">${customFooter}</div>` : "",
    )
    .replace(/{{buildDate}}/g, new Date().toLocaleDateString())
    .replace(/{{toc}}/g, tocHtml);
}

export { md, convert, setTemplateContent };

import path from "path";
import chalk from "chalk";
import yaml from "js-yaml";
import { Command } from "commander";

export const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n/;

export const stopLoading = (templatePath) => {
  const msg = chalk.red(`Error loading template from ${templatePath}:`);

  console.error(msg, err);

  process.exit(1);
};

export const makeInputMsg = (inputDir) => {
  return chalk.bold.gray(`Input:  ${inputDir}`);
};

export const makeOutputMsg = (outputDir) => {
  return chalk.bold.gray(`Output: ${outputDir}\n`);
};

export const startingLog = (inputDir, outputDir) => {
  const msg = chalk.bold.blue("🚀 Starting Markdown Export...");

  console.log(msg);
  console.log(makeInputMsg(inputDir));
  console.log(makeOutputMsg(outputDir));
};

export const showHomePageMsg = (firstNode) => {
  console.log(
    chalk.green(`Homepage synchronized from: ${firstNode.fullRelativePath}`),
  );
};

export const showNotFoundMDFile = () => {
  const msg = chalk.yellow(
    "⚠️ No Markdown files found in the input directory.",
  );

  console.log(msg);
};

// Helper to strip numeric prefix from a single path segment
/**
 * Removes numeric prefixes from a path segment (e.g., "01.guide" -> "guide").
 * @param {string} segment - The path segment.
 * @returns {string} The cleaned segment.
 */
export function cleanSegment(segment) {
  return segment.replace(/^\d+\.?\s*/, "");
}

// Helper to clean an entire relative path
/**
 * Cleans an entire file path by removing numeric prefixes from all segments.
 * @param {string} filePath - The original file path.
 * @returns {string} The cleaned file path.
 */
export function getCleanPath(filePath) {
  return filePath.split(path.sep).map(cleanSegment).join(path.sep);
}

// Helper to prune titles for navigation (e.g., "01.Welcome Zed" -> "Welcome")
/**
 * Prunes the title string by removing numeric prefixes and specific suffixes.
 * @param {string} title - The raw title string.
 * @returns {string} The pruned title.
 */
export function pruneTitle(title) {
  if (!title) return title;
  // Remove numeric prefixes like "01.", "1.", etc.
  let cleaned = cleanSegment(title);
  // Remove trailing " Zed" suffix
  return cleaned.replace(/\s+Zed$/i, "").trim();
}

// Helper to get title from frontmatter
/**
 * Extracts the title from a markdown file, checking frontmatter first, then the first H1 hearing.
 * @param {string} filePath - The path to the markdown file.
 * @returns {Promise<string|null>} The extracted title or null.
 */
export async function getFileTitle(filePath) {
  try {
    const content = readFileSync(filePath, { encoding: "utf-8" });

    const match = content.match(FRONTMATTER_REGEX);

    let body = content;

    if (match) {
      const data = yaml.load(match[1]);

      if (data && data.title) {
        return pruneTitle(data.title);
      }

      body = content.replace(FRONTMATTER_REGEX, "");
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
/**
 * Builds a hierarchical tree structure from a list of files.
 * Identifies index files for directories and organizes content.
 *
 * @param {Array<string>} files - List of relative file paths.
 * @param {string} inputDir - Base input directory.
 * @returns {Promise<Object>} The file tree structure.
 */
export async function buildFileTree(files, inputDir) {
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
          type: "file",
          fullRelativePath: file,
          cleanRelativePath: cleanFile,
          title,
        };
      } else {
        if (!current[part]) {
          current[part] = {
            type: "directory",
            children: {},
            cleanRelativePath: getCleanPath(
              parts.slice(0, i + 1).join(path.sep),
            ),
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
      if (node.type === "directory") {
        findIndexFiles(node.children);

        const cleanName = cleanSegment(name);

        // Find index.md or [folderName].md
        let indexNode = null;
        let indexKey = null;

        for (const [childName, childNode] of Object.entries(node.children)) {
          if (childNode.type === "file") {
            const cleanChildName = cleanSegment(childName);
            if (
              cleanChildName === "index.md" ||
              cleanChildName === `${cleanName}.md`
            ) {
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
/**
 * Finds the first logical file in the tree (honoring numeric sorting).
 * Used to determine the homepage content.
 * @param {Object} tree - The file tree.
 * @returns {Object|null} The first file node.
 */
export function findFirstFile(tree) {
  const flat = flattenFileTree(tree);
  return flat.length > 0 ? flat[0] : null;
}

// Flatten the sorted tree into a sequence of pages
/**
 * Flattens the file tree into a sequential list of pages.
 * Used for generating "Previous" and "Next" links.
 *
 * @param {Object} tree - The file tree.
 * @returns {Array<Object>} Sorted list of file nodes.
 */
export function flattenFileTree(tree) {
  let flat = [];
  const entries = Object.entries(tree).sort(([a, nodeA], [b, nodeB]) => {
    const numA = parseInt(a.match(/^(\d+)/)?.[1]);
    const numB = parseInt(b.match(/^(\d+)/)?.[1]);
    if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
    if (nodeA.type !== nodeB.type) return nodeA.type === "directory" ? -1 : 1;
    return a.localeCompare(b);
  });

  for (const [name, node] of entries) {
    if (node.type === "directory") {
      if (node.indexFile) flat.push(node.indexFile);
      if (node.children) flat = flat.concat(flattenFileTree(node.children));
    } else {
      flat.push(node);
    }
  }
  return flat;
}

/**
 *
 * @param {Function} callback
 * @returns
 */
export const createCommand = (callback) => {
  new Command()
    .name("mdex")
    .description(
      "A premium CLI tool to convert Markdown files to static HTML documentation.",
    )
    .version("1.0.0")
    .option("-i, --input <dir>", "Input directory containing .md files", ".")
    .option("-o, --output <dir>", "Output directory for HTML files", "dist")
    .option("-v, --verbose", "Enable verbose logging", false)
    .action(callback)
    .parse(process.argv);
};

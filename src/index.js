#!/usr/bin/env node

import {
  mkdirSync,
  existsSync,
  readdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "fs";
import path from "path";
import chalk from "chalk";

import { md, setTemplateContent, convert } from "./converter.js";
import {
  stopLoading,
  startingLog,
  showNotFoundMDFile,
  createCommand,
  getCleanPath,
  buildFileTree,
  flattenFileTree,
  findFirstFile,
  showHomePageMsg,
} from "./utils.js";

createCommand(async (options) => {
  // Load template
  const __dirname = import.meta.dirname;

  const inputDir = path.resolve(options.input);
  const outputDir = path.resolve(options.output);

  const headerPath = path.join(inputDir, "header.md");
  const footerPath = path.join(inputDir, "footer.md");
  const templatePath = path.join(__dirname, "assets", "template.html");

  try {
    const loadedTemplate = readFileSync(templatePath, { encoding: "utf-8" });

    // --- Custom Header/Footer Processing ---
    let customHeader = null;
    let customFooter = null;

    if (existsSync(headerPath)) {
      if (options.verbose) {
        console.log(chalk.gray("Found custom header.md"));
      }

      const headerContent = readFileSync(headerPath, { encoding: "utf-8" });
      customHeader = md.render(headerContent);
    }

    if (existsSync(footerPath)) {
      if (options.verbose) {
        console.log(chalk.gray("Found custom footer.md"));
      }

      const footerContent = readFileSync(footerPath, { encoding: "utf-8" });
      customFooter = md.render(footerContent);
    }

    setTemplateContent(loadedTemplate);

    startingLog(inputDir, outputDir);

    const files = readdirSync(inputDir, {
      recursive: true,
      withFileTypes: false,
    })
      .filter((c) => /.+\/.+\.md$/.test(c))
      .filter((c) => !/(node_modules|dist|\.git)/.test(c));

    if (files.length === 0) {
      showNotFoundMDFile();
    } else {
      console.log(chalk.cyan(`Building navigation tree...`));
      const fileTree = await buildFileTree(files, inputDir);

      console.log(chalk.cyan(`Converting ${files.length} markdown file(s)...`));

      const flatTree = flattenFileTree(fileTree);

      for (const file of files) {
        const filePath = path.join(inputDir, file);
        const content = readFileSync(filePath, { encoding: "utf-8" });

        const cleanRelPath = getCleanPath(file);
        const outputFilePath = path.join(
          outputDir,
          cleanRelPath.replace(/\.md$/, ".html"),
        );

        // Find current node and neighbors for pagination
        const currentIndex = flatTree.findIndex(
          (n) => n.fullRelativePath === file,
        );
        const prev = currentIndex > 0 ? flatTree[currentIndex - 1] : null;
        const next =
          currentIndex < flatTree.length - 1
            ? flatTree[currentIndex + 1]
            : null;

        // Calculate relative level for clean paths
        const depth = cleanRelPath.split(path.sep).length - 1;
        const relativeLevel = depth === 0 ? "./" : "../".repeat(depth);

        if (options.verbose) {
          console.log(
            chalk.gray(
              `Processing: ${file} -> ${path.relative(outputDir, outputFilePath)}`,
            ),
          );
        }

        const html = convert(
          content,
          file,
          fileTree,
          file,
          relativeLevel,
          prev,
          next,
          customHeader,
          customFooter,
        );

        mkdirSync(path.dirname(outputFilePath), { recursive: true });

        writeFileSync(outputFilePath, html, { encoding: "utf-8" });
      }

      const msg = chalk.green.bold("\n✨ Export completed successfully!");

      console.log(msg);

      // --- Ensure root index.html exists and is up to date ---
      const rootIndexDest = path.join(outputDir, "index.html");
      const firstNode = findFirstFile(fileTree);

      if (firstNode) {
        if (options.verbose)
          console.log(
            chalk.gray("Updating root index.html from first page..."),
          );
        const content = readFileSync(
          path.join(inputDir, firstNode.fullRelativePath),
          { encoding: "utf-8" },
        );
        const html = convert(
          content,
          firstNode.fullRelativePath,
          fileTree,
          firstNode.fullRelativePath,
          "./",
          null,
          null,
          customHeader,
          customFooter,
        );

        writeFileSync(rootIndexDest, html, { encoding: "utf-8" });

        showHomePageMsg(firstNode);
      }

      // Copy assets (CSS, JS, Fonts) to output directory
      const jsSrc = path.join(__dirname, "assets", "script.js");
      const jsDest = path.join(outputDir, "assets", "script.js");

      const cssSrc = path.join(__dirname, "assets", "modern.css");
      const cssDest = path.join(outputDir, "assets", "modern.css");

      mkdirSync(path.join(outputDir, "assets"), { recursive: true });

      copyFileSync(jsSrc, jsDest);
      copyFileSync(cssSrc, cssDest);

      console.log(chalk.blue(`View your site in: ${outputDir}`));
    }
  } catch (err) {
    stopLoading(templatePath, err);
  }
});

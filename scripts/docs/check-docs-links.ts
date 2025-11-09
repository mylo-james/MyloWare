#!/usr/bin/env tsx
/**
 * Check documentation for broken links
 * 
 * Usage:
 *   npm run docs:check-links
 * */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const DOCS_DIR = join(process.cwd(), 'docs');
const ROOT_DIR = process.cwd();

interface LinkIssue {
  file: string;
  line: number;
  link: string;
  issue: string;
}

const issues: LinkIssue[] = [];
const allFiles = new Set<string>();

/**
 * Recursively find all markdown files
 */
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...findMarkdownFiles(fullPath));
    } else if (entry.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Extract markdown links from content
 */
function extractLinks(content: string): Array<{ link: string; line: number }> {
  const links: Array<{ link: string; line: number }> = [];
  const lines = content.split('\n');
  
  // Match [text](link) and [text]: link
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)|\[([^\]]+)\]:\s*(\S+)/g;
  
  lines.forEach((line, index) => {
    let match;
    while ((match = linkRegex.exec(line)) !== null) {
      const link = match[2] || match[4];
      if (link) {
        links.push({ link, line: index + 1 });
      }
    }
  });
  
  return links;
}

/**
 * Check if internal link is valid
 */
function checkInternalLink(sourceFile: string, link: string): string | null {
  // Remove anchor
  const [path] = link.split('#');
  
  // Resolve relative to source file
  const sourceDir = resolve(sourceFile, '..');
  const targetPath = resolve(sourceDir, path);
  
  // Check if file exists
  try {
    statSync(targetPath);
    return null;
  } catch {
    return `File not found: ${relative(ROOT_DIR, targetPath)}`;
  }
}

/**
 * Check all links in a file
 */
function checkFile(filePath: string): void {
  const content = readFileSync(filePath, 'utf-8');
  const links = extractLinks(content);
  
  for (const { link, line } of links) {
    // Skip external links (would need network check)
    if (link.startsWith('http://') || link.startsWith('https://')) {
      continue;
    }
    
    // Skip anchors only
    if (link.startsWith('#')) {
      continue;
    }
    
    // Check internal link
    const issue = checkInternalLink(filePath, link);
    if (issue) {
      issues.push({
        file: relative(ROOT_DIR, filePath),
        line,
        link,
        issue,
      });
    }
  }
}

/**
 * Find orphaned pages (not linked from anywhere)
 */
function findOrphanedPages(files: string[]): string[] {
  const linkedFiles = new Set<string>();
  
  // Extract all internal links
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const links = extractLinks(content);
    
    for (const { link } of links) {
      if (!link.startsWith('http') && !link.startsWith('#')) {
        const [path] = link.split('#');
        const sourceDir = resolve(file, '..');
        const targetPath = resolve(sourceDir, path);
        linkedFiles.add(targetPath);
      }
    }
  }
  
  // Find files not in linked set
  const orphaned: string[] = [];
  const indexPath = join(DOCS_DIR, 'README.md');
  
  for (const file of files) {
    // Skip index and archive
    if (file === indexPath || file.includes('/archive/')) {
      continue;
    }
    
    if (!linkedFiles.has(file)) {
      orphaned.push(relative(ROOT_DIR, file));
    }
  }
  
  return orphaned;
}

// Main
console.log('Checking documentation links...\n');

// Find all markdown files
const markdownFiles = [
  ...findMarkdownFiles(DOCS_DIR),
  join(ROOT_DIR, 'README.md'),
  join(ROOT_DIR, 'AGENTS.md'),
];

markdownFiles.forEach((file) => allFiles.add(file));

// Check each file
for (const file of markdownFiles) {
  checkFile(file);
}

// Find orphaned pages
const orphaned = findOrphanedPages(markdownFiles);

// Report results
if (issues.length === 0 && orphaned.length === 0) {
  console.log('✓ All links valid');
  console.log(`  Checked ${markdownFiles.length} files`);
  process.exit(0);
}

if (issues.length > 0) {
  console.log(`✗ Found ${issues.length} broken link(s):\n`);
  
  for (const issue of issues) {
    console.log(`  ${issue.file}:${issue.line}`);
    console.log(`    Link: ${issue.link}`);
    console.log(`    Issue: ${issue.issue}\n`);
  }
}

if (orphaned.length > 0) {
  console.log(`⚠️  Found ${orphaned.length} orphaned page(s):\n`);
  
  for (const file of orphaned) {
    console.log(`  ${file}`);
  }
  console.log('\n  These pages are not linked from any other page.');
}

process.exit(issues.length > 0 ? 1 : 0);



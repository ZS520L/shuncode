import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const EDITING_FILES_TEMPLATE_TEXT = `EDITING FILES

You have access to two tools for working with files: **write_to_file** and **replace_in_file**. Understanding their roles and selecting the right one for the job will help ensure efficient and accurate modifications.

# write_to_file

## Purpose

- Create a new file, or overwrite the entire contents of an existing file.

## When to Use

- Initial file creation, such as when scaffolding a new project.
- Overwriting large boilerplate files where you want to replace the entire content at once.
- When the complexity or number of changes would make replace_in_file unwieldy or error-prone.
- When you need to completely restructure a file's content or change its fundamental organization.

## Important Considerations

- Using write_to_file requires providing the file's complete final content.
- If you only need to make small changes to an existing file, consider using replace_in_file instead to avoid unnecessarily rewriting the entire file.
- CRITICAL: Do NOT use write_to_file to add a few lines to an existing file. Use replace_in_file with small SEARCH/REPLACE blocks instead. write_to_file rewrites the ENTIRE file and makes it much harder for the user to review changes.
- While write_to_file should not be your default choice, don't hesitate to use it when the situation truly calls for it.

# replace_in_file

## Purpose

- Make targeted edits to specific parts of an existing file without overwriting the entire file.

## When to Use

- Small, localized changes like updating a few lines, function implementations, changing variable names, modifying a section of text, etc.
- Targeted improvements where only specific portions of the file's content needs to be altered.
- Especially useful for long files where much of the file will remain unchanged.

## Advantages

- More efficient for minor edits, since you don't need to supply the entire file content.
- Reduces the chance of errors that can occur when overwriting large files.

# Choosing the Appropriate Tool

- **Default to replace_in_file** for most changes. It's the safer, more precise option that minimizes potential issues.
- **Use write_to_file** when:
  - Creating new files
  - The changes are so extensive that using replace_in_file would be more complex or risky
  - You need to completely reorganize or restructure a file
  - The file is relatively small and the changes affect most of its content
  - You're generating boilerplate or template files
- **Use append_to_file** when:
  - Writing large content (>200 lines) that would take too long to generate in a single write_to_file call
  - Building up a file incrementally in multiple chunks (e.g. writing a long article, full book text, large datasets)
  - The user asks you to write very long text content (poems, articles, translations, full documents)

# append_to_file

## Purpose

- Append content to the end of an existing file, or create the file if it doesn't exist.
- Designed for writing large files in multiple chunks — you can call this tool repeatedly to build up file content piece by piece.

## When to Use

- When the content is too large to generate in a single response (>200 lines or >3000 characters).
- When writing long documents, articles, book chapters, or any large text that benefits from incremental output.
- CRITICAL: For large text content, ALWAYS split into multiple append_to_file calls (e.g. write 50-100 lines per call). This is much faster than trying to generate everything in one write_to_file call.

## Strategy for Large Files

1. First call: use write_to_file or append_to_file to create the file with the first chunk.
2. Subsequent calls: use append_to_file to add more content.
3. Each chunk should be 50-100 lines to ensure fast response times.
4. Do NOT try to generate an entire large document in a single tool call — split it up!

# Auto-formatting Considerations

- After using either write_to_file or replace_in_file, the user's editor may automatically format the file
- This auto-formatting may modify the file contents, for example:
  - Breaking single lines into multiple lines
  - Adjusting indentation to match project style (e.g. 2 spaces vs 4 spaces vs tabs)
  - Converting single quotes to double quotes (or vice versa based on project preferences)
  - Organizing imports (e.g. sorting, grouping by type)
  - Adding/removing trailing commas in objects and arrays
  - Enforcing consistent brace style (e.g. same-line vs new-line)
  - Standardizing semicolon usage (adding or removing based on style)
- The write_to_file and replace_in_file tool responses will include the final state of the file after any auto-formatting
- Use this final state as your reference point for any subsequent edits. This is ESPECIALLY important when crafting SEARCH blocks for replace_in_file which require the content to match what's in the file exactly.

# Workflow Tips

1. Before editing, assess the scope of your changes and decide which tool to use.
2. For targeted edits, apply replace_in_file with carefully crafted SEARCH/REPLACE blocks. If you need multiple changes, you can stack multiple SEARCH/REPLACE blocks within a single replace_in_file call.
3. IMPORTANT: When you determine that you need to make several changes to the same file, prefer to use a single replace_in_file call with multiple SEARCH/REPLACE blocks. DO NOT prefer to make multiple successive replace_in_file calls for the same file. For example, if you were to add a component to a file, you would use a single replace_in_file call with a SEARCH/REPLACE block to add the import statement and another SEARCH/REPLACE block to add the component usage, rather than making one replace_in_file call for the import statement and then another separate replace_in_file call for the component usage.
4. For major overhauls or initial file creation, rely on write_to_file.
5. Once the file has been edited with either write_to_file or replace_in_file, the system will provide you with the final state of the modified file. Use this updated content as the reference point for any subsequent SEARCH/REPLACE operations, since it reflects any auto-formatting or user-applied changes.
6. CRITICAL: When modifying an EXISTING file, you MUST first read it with read_file to get its current content. Never assume you know the file's current state — it may have been auto-formatted, edited by the user, or changed by a previous tool call. Always read before editing.
7. CRITICAL: Do NOT use write_to_file to modify an existing file unless you intend to completely replace ALL of its content. If you only need to add, change, or remove specific parts, use replace_in_file instead. Using write_to_file on an existing file without including all original content will DESTROY everything you don't include.
By thoughtfully selecting between write_to_file and replace_in_file, you can make your file editing process smoother, safer, and more efficient.`

export async function getEditingFilesSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
  const template = variant.componentOverrides?.[SystemPromptSection.EDITING_FILES]?.template || EDITING_FILES_TEMPLATE_TEXT

  return new TemplateEngine().resolve(template, context, {})
}

/**
 * SyntaxValidator - Проверка синтаксиса кода через Tree-sitter
 *
 * Используется для:
 * 1. Проверки кода перед применением diff
 * 2. Обнаружения новых ошибок после изменений
 * 3. Обратной связи для AI модели
 */

import * as path from 'path';
import Parser from 'web-tree-sitter';

export interface SyntaxError {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  type: 'ERROR' | 'MISSING';
}

export interface ValidationResult {
  valid: boolean;
  errors: SyntaxError[];
  language: string | null;
}

export interface ChangeValidationResult {
  valid: boolean;
  canApply: boolean;
  originalErrors: SyntaxError[];
  newErrors: SyntaxError[];
  addedErrors: SyntaxError[]; // Ошибки которые появились после изменения
}

// Map file extensions to tree-sitter language names
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  'js': 'javascript',
  'jsx': 'javascript',
  'ts': 'typescript',
  'tsx': 'tsx',
  'py': 'python',
  'rs': 'rust',
  'go': 'go',
  'c': 'c',
  'h': 'c',
  'cpp': 'cpp',
  'hpp': 'cpp',
  'cs': 'c_sharp',
  'rb': 'ruby',
  'java': 'java',
  'php': 'php',
  'swift': 'swift',
  'kt': 'kotlin',
};

/**
 * SyntaxValidator using Tree-sitter for syntax validation
 */
export class SyntaxValidator {
  private static instance: SyntaxValidator | null = null;
  private initialized = false;
  private loadedLanguages: Map<string, Parser.Language> = new Map();
  private wasmDir: string;

  private constructor(wasmDir?: string) {
    this.wasmDir = wasmDir || __dirname;
  }

  static getInstance(): SyntaxValidator {
    if (!SyntaxValidator.instance) {
      SyntaxValidator.instance = new SyntaxValidator();
    }
    return SyntaxValidator.instance;
  }

  /**
   * Create a new instance with custom WASM directory (for testing).
   * Does NOT affect the singleton.
   */
  static createForTest(wasmDir: string): SyntaxValidator {
    return new SyntaxValidator(wasmDir);
  }

  /**
   * Initialize the Tree-sitter parser
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await Parser.init();
      this.initialized = true;
      console.log('[SyntaxValidator] Initialized successfully');
    } catch (error) {
      console.error('[SyntaxValidator] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Get language name from file extension
   */
  private getLanguageForFile(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    return EXTENSION_TO_LANGUAGE[ext] || null;
  }

  /**
   * Load a language parser
   */
  private async loadLanguage(langName: string): Promise<Parser.Language | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Check cache
    if (this.loadedLanguages.has(langName)) {
      return this.loadedLanguages.get(langName)!;
    }

    try {
      const wasmPath = path.join(this.wasmDir, `tree-sitter-${langName}.wasm`);
      console.log(`[SyntaxValidator] Loading language from: ${wasmPath}`);

      const language = await Parser.Language.load(wasmPath);
      this.loadedLanguages.set(langName, language);
      console.log(`[SyntaxValidator] Loaded language: ${langName}`);
      return language;
    } catch (error) {
      console.warn(`[SyntaxValidator] Failed to load language ${langName}:`, error);
      return null;
    }
  }

  /**
   * Find all syntax errors in a tree
   */
  private findErrors(node: Parser.SyntaxNode, errors: SyntaxError[] = []): SyntaxError[] {
    // Check if this node is an error
    if (node.type === 'ERROR') {
      errors.push({
        line: node.startPosition.row + 1, // 1-indexed
        column: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
        message: `Syntax error: unexpected content`,
        type: 'ERROR',
      });
    }

    // Check if this node is missing (expected but not found)
    if (node.isMissing) {
      errors.push({
        line: node.startPosition.row + 1,
        column: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
        message: `Missing: ${node.type}`,
        type: 'MISSING',
      });
    }

    // Check hasError flag on nodes (indicates error somewhere in subtree)
    if (node.hasError || node.type === 'ERROR' || node.isMissing) {
      for (const child of node.children) {
        this.findErrors(child, errors);
      }
    } else {
      // Still need to check children for errors
      for (const child of node.children) {
        if (child.hasError || child.type === 'ERROR' || child.isMissing) {
          this.findErrors(child, errors);
        }
      }
    }

    return errors;
  }

  /**
   * Validate code syntax
   */
  async validate(filePath: string, code: string): Promise<ValidationResult> {
    const langName = this.getLanguageForFile(filePath);

    if (!langName) {
      return {
        valid: true, // Unknown languages are considered valid (can't check)
        errors: [],
        language: null,
      };
    }

    const language = await this.loadLanguage(langName);

    if (!language) {
      return {
        valid: true, // If we can't load the language, assume valid
        errors: [],
        language: langName,
      };
    }

    try {
      const parser = new Parser();
      parser.setLanguage(language);
      const tree = parser.parse(code);
      const errors = this.findErrors(tree.rootNode);

      if (errors.length > 0) {
        console.log(`[SyntaxValidator] Found ${errors.length} errors in ${path.basename(filePath)}`);
      }

      return {
        valid: errors.length === 0,
        errors,
        language: langName,
      };
    } catch (error) {
      console.error(`[SyntaxValidator] Parse error for ${filePath}:`, error);
      return {
        valid: true, // On parse failure, assume valid
        errors: [],
        language: langName,
      };
    }
  }

  /**
   * Validate a code change before applying
   * Returns info about whether the change introduces new errors
   */
  async validateChange(
    filePath: string,
    originalCode: string,
    newCode: string
  ): Promise<ChangeValidationResult> {
    // Validate original code
    const originalResult = await this.validate(filePath, originalCode);

    // Validate new code
    const newResult = await this.validate(filePath, newCode);

    // Find errors that were added (exist in new but not in original)
    const addedErrors = newResult.errors.filter((newErr) => {
      // Check if this error existed before (by comparing line/column/type)
      return !originalResult.errors.some(
        (origErr) =>
          origErr.line === newErr.line &&
          origErr.column === newErr.column &&
          origErr.type === newErr.type
      );
    });

    // If original had errors, we're more lenient
    // Only block if we're adding MORE errors
    const hadErrors = originalResult.errors.length > 0;
    const canApply = hadErrors
      ? newResult.errors.length <= originalResult.errors.length
      : newResult.valid;

    return {
      valid: newResult.valid,
      canApply,
      originalErrors: originalResult.errors,
      newErrors: newResult.errors,
      addedErrors,
    };
  }

  /**
   * Format errors for display to the model
   */
  formatErrorsForModel(errors: SyntaxError[]): string {
    if (errors.length === 0) return '';

    const lines = errors.slice(0, 5).map((err) => {
      return `  Line ${err.line}: ${err.message}`;
    });

    if (errors.length > 5) {
      lines.push(`  ... and ${errors.length - 5} more errors`);
    }

    return lines.join('\n');
  }
}

// Export singleton instance
export const syntaxValidator = SyntaxValidator.getInstance();

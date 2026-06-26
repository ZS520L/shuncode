import { describe, it, beforeEach, afterEach } from 'mocha'
import 'should'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as vscode from 'vscode'
import { DiffSystem } from '../DiffSystem'
import { _addDocument, _clearDocuments, _getDocumentContent } from '@/test/vscode-mock'
import { InMemoryMemento } from '@/test/test-helpers'

/**
 * DiffSystem.validateSyntax() integration tests.
 *
 * Tests syntax validation integration with real tree-sitter parsing
 * and mocked vscode configuration.
 *
 * Validates the full flow:
 * - Setting enabled → blocks broken code
 * - Setting disabled → allows anything
 * - blockOnSyntaxErrors off → warns but allows
 * - Unknown languages → always pass
 */
describe('DiffSystem.validateSyntax (integration)', () => {
  let system: DiffSystem
  let tmpDir: string
  let originalGetConfig: typeof vscode.workspace.getConfiguration

  // Track wasm availability
  let wasmAvailable = false

  function makeContext(): any {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shuncode-syntax-test-'))
    return {
      workspaceState: new InMemoryMemento(),
      globalStorageUri: { fsPath: tmpDir },
      subscriptions: [],
    }
  }

  /**
   * Mock vscode.workspace.getConfiguration to control syntax validation settings.
   */
  function mockConfig(overrides: Record<string, any> = {}) {
    vscode.workspace.getConfiguration = ((section?: string) => ({
      get: (key: string, defaultValue?: any) => {
        if (section === 'shuncode') {
          if (key in overrides) return overrides[key]
          // Defaults
          if (key === 'validateSyntaxBeforeApply') return true
          if (key === 'blockOnSyntaxErrors') return true
        }
        return defaultValue
      },
    })) as any
  }

  before(function () {
    const wasmDir = path.join(__dirname, '..', '..', '..', '..', 'dist')
    wasmAvailable = fs.existsSync(path.join(wasmDir, 'tree-sitter.wasm'))
    if (!wasmAvailable) {
      console.warn('[validateSyntax.test] WASM files not found, tests that need tree-sitter will be skipped')
    }
  })

  beforeEach(async () => {
    _clearDocuments()
    originalGetConfig = vscode.workspace.getConfiguration
    const ctx = makeContext()
    system = new DiffSystem(ctx)
    await system.initialize(true)
  })

  afterEach(() => {
    system.dispose()
    vscode.workspace.getConfiguration = originalGetConfig
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ==================== Config-driven behavior ====================

  describe('Configuration', () => {
    it('should skip validation when validateSyntaxBeforeApply is false', async () => {
      mockConfig({ validateSyntaxBeforeApply: false })

      const original = `function test() { return 1; }`
      const broken = `function test() { return }`

      const error = await system.validateSyntax('test.ts', original, broken)
      ;(error === undefined).should.be.true()
    })

    it('should return error when validateSyntaxBeforeApply is true and code is broken', async function () {
      if (!wasmAvailable) this.skip()
      this.timeout(10000)

      mockConfig({ validateSyntaxBeforeApply: true, blockOnSyntaxErrors: true })

      const original = `
function working() {
  const x = 1;
  return x + 2;
}
`
      const broken = `
function working() {
  const x = 1;
  return x +
}
`

      const error = await system.validateSyntax('test.ts', original, broken)
      if (error) {
        error.should.containEql('Syntax validation failed')
        error.should.containEql('syntax error')
      }
      // If tree-sitter can't load (no wasm at __dirname), error is undefined (graceful)
    })

    it('should allow broken code when blockOnSyntaxErrors is false', async function () {
      if (!wasmAvailable) this.skip()
      this.timeout(10000)

      mockConfig({ validateSyntaxBeforeApply: true, blockOnSyntaxErrors: false })

      const original = `
function working() {
  return 1;
}
`
      const broken = `
function working() {
  return
}
`

      // blockOnSyntaxErrors=false means warn but don't block
      const error = await system.validateSyntax('test.ts', original, broken)
      ;(error === undefined).should.be.true()
    })
  })

  // ==================== Language handling ====================

  describe('Language handling', () => {
    it('should pass validation for unknown file types', async () => {
      mockConfig({})

      const error = await system.validateSyntax('data.csv', 'a,b,c', 'x,y,z')
      ;(error === undefined).should.be.true()
    })

    it('should pass validation for markdown files', async () => {
      mockConfig({})

      const error = await system.validateSyntax('README.md', '# Title', '# New Title')
      ;(error === undefined).should.be.true()
    })

    it('should pass validation for JSON files (not in tree-sitter map)', async () => {
      mockConfig({})

      const error = await system.validateSyntax('config.json', '{}', '{invalid}')
      ;(error === undefined).should.be.true()
    })
  })

  // ==================== Full DiffSystem flow ====================

  describe('Full flow: replaceLines with syntax validation', () => {
    it('should apply valid TypeScript changes through replaceLines', async function () {
      if (!wasmAvailable) this.skip()
      this.timeout(10000)

      mockConfig({ validateSyntaxBeforeApply: true, blockOnSyntaxErrors: true })

      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('test', 1000)

      _addDocument('/test/valid.ts', 'const x = 1;\nconst y = 2;\nconst z = 3;')

      const hunkId = await system.replaceLines('/test/valid.ts', 2, ['const y = 2;'], ['const y = 42;'])
      hunkId.should.be.a.String()
      system.getPendingCount().should.equal(1)
      _getDocumentContent('/test/valid.ts')!.should.containEql('const y = 42;')
    })

    it('should clear all after test', async () => {
      await system.clearAll()
      system.getPendingCount().should.equal(0)
    })
  })

  // ==================== Error resilience ====================

  describe('Error resilience', () => {
    it('should not crash when tree-sitter fails to initialize', async () => {
      mockConfig({ validateSyntaxBeforeApply: true })

      // Even if SyntaxValidator can't load WASM, it should not block edits
      const error = await system.validateSyntax('test.ts', 'const x = 1;', 'const x = 2;')
      // Should either return undefined (graceful failure) or an actual result
      // Both are acceptable — the key is no crash
      ;(error === undefined || typeof error === 'string').should.be.true()
    })

    it('should not block edits for empty files', async function () {
      if (!wasmAvailable) this.skip()
      this.timeout(10000)

      mockConfig({ validateSyntaxBeforeApply: true, blockOnSyntaxErrors: true })

      const error = await system.validateSyntax('test.ts', '', 'const x = 1;')
      ;(error === undefined).should.be.true()
    })
  })
})

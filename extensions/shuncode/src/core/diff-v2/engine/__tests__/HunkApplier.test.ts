import { describe, it, beforeEach } from 'mocha'
import 'should'
import { HunkApplier } from '../HunkApplier'
import { PositionTracker } from '../PositionTracker'
import { SystemEditGuard } from '../SystemEditGuard'
import { DiffStore } from '../../storage/DiffStore'
import { FileSnapshotStorage } from '../../storage/FileSnapshotStorage'
import { InMemoryMemento } from '@/test/test-helpers'
import { _addDocument, _clearDocuments, _getDocumentContent } from '@/test/vscode-mock'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('HunkApplier', () => {
  let store: DiffStore
  let snapshotStorage: FileSnapshotStorage
  let positionTracker: PositionTracker
  let editGuard: SystemEditGuard
  let applier: HunkApplier
  let tmpDir: string
  let rgId: string

  const FILE = '/test/file.ts'
  const CONTENT_5_LINES = 'line1\nline2\nline3\nline4\nline5'

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shuncode-hunk-test-'))
    store = new DiffStore(new InMemoryMemento() as any)
    snapshotStorage = new FileSnapshotStorage(tmpDir)
    await snapshotStorage.initialize()
    positionTracker = new PositionTracker(store)
    editGuard = new SystemEditGuard()
    applier = new HunkApplier(store, snapshotStorage, positionTracker, editGuard)

    rgId = store.createResponseGroup(Date.now(), 'test')

    _clearDocuments()
  })

  // ==================== applyReplacement ====================

  describe('applyReplacement', () => {
    it('should replace lines correctly in file', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      const hunkId = await applier.applyReplacement(FILE, 2, ['line2'], ['NEW LINE 2'], rgId)
      hunkId.should.be.a.String()

      const content = _getDocumentContent(FILE)!
      content.should.containEql('NEW LINE 2')
      content.should.not.containEql('line2')
    })

    it('should store removedLines from ACTUAL file, not caller', async () => {
      // File has indented line, but caller sends without indent (dumb model)
      _addDocument(FILE, '  indented line\nline2\nline3')

      const hunkId = await applier.applyReplacement(
        FILE, 1,
        ['indented line'],  // caller says no indent (WRONG)
        ['new content'],
        rgId
      )

      const hunk = store.getHunk(hunkId)!
      // removedLines should be from FILE (with indent), not from caller
      hunk.removedLines[0].should.equal('  indented line')
    })

    it('should handle multi-line replacement (2→4 lines)', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      await applier.applyReplacement(FILE, 2, ['line2', 'line3'], ['new2', 'new3', 'new4', 'new5'], rgId)

      const content = _getDocumentContent(FILE)!
      const lines = content.split('\n')
      lines[1].should.equal('new2')
      lines[2].should.equal('new3')
      lines[3].should.equal('new4')
      lines[4].should.equal('new5')
      lines.length.should.equal(7) // was 5, replaced 2 with 4
    })

    it('should handle replacement that reduces lines (3→1)', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      await applier.applyReplacement(FILE, 2, ['line2', 'line3', 'line4'], ['single'], rgId)

      const content = _getDocumentContent(FILE)!
      const lines = content.split('\n')
      lines.length.should.equal(3) // was 5, replaced 3 with 1
      lines[1].should.equal('single')
    })

    it('should create FileChange record', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      await applier.applyReplacement(FILE, 1, ['line1'], ['new'], rgId)

      const fcs = store.getFileChangesByResponseGroup(rgId)
      fcs.length.should.equal(1)
      fcs[0].fsPath.should.equal(FILE)
    })

    it('should create Hunk record with correct type', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      const hunkId = await applier.applyReplacement(FILE, 1, ['line1'], ['new'], rgId)
      const hunk = store.getHunk(hunkId)!
      hunk.type.should.equal('replacement')
      hunk.status.should.equal('pending')
    })

    it('should throw for invalid startLine (0)', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      try {
        await applier.applyReplacement(FILE, 0, ['x'], ['y'], rgId)
        throw new Error('Should have thrown')
      } catch (err: any) {
        err.message.should.containEql('Invalid start line')
      }
    })

    it('should throw for startLine > lineCount', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      try {
        await applier.applyReplacement(FILE, 100, ['x'], ['y'], rgId)
        throw new Error('Should have thrown')
      } catch (err: any) {
        err.message.should.containEql('Invalid start line')
      }
    })
  })

  // ==================== applyDeletion ====================

  describe('applyDeletion', () => {
    it('should remove correct lines from file', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      const result = await applier.applyDeletion(FILE, 2, 2, rgId)
      result.deletedContent.should.equal('line2\nline3')

      const content = _getDocumentContent(FILE)!
      content.should.not.containEql('line2')
      content.should.not.containEql('line3')
    })

    it('should store removedLines from actual file', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      const result = await applier.applyDeletion(FILE, 3, 1, rgId)
      const hunk = store.getHunk(result.hunkId)!
      hunk.removedLines.should.deepEqual(['line3'])
      hunk.type.should.equal('deletion')
    })

    it('should handle single line deletion', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      await applier.applyDeletion(FILE, 1, 1, rgId)
      const content = _getDocumentContent(FILE)!
      content.split('\n').length.should.equal(4)
    })
  })

  // ==================== applyAddition ====================

  describe('applyAddition', () => {
    it('should insert lines at correct position', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      const hunkId = await applier.applyAddition(FILE, 2, ['inserted1', 'inserted2'], rgId)

      const content = _getDocumentContent(FILE)!
      const lines = content.split('\n')
      lines[2].should.equal('inserted1')
      lines[3].should.equal('inserted2')
      lines.length.should.equal(7)
    })

    it('should insert at beginning (afterLine=0)', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      await applier.applyAddition(FILE, 0, ['header'], rgId)

      const content = _getDocumentContent(FILE)!
      content.split('\n')[0].should.equal('header')
    })

    it('should insert at end (afterLine=lineCount)', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      await applier.applyAddition(FILE, 5, ['footer'], rgId)

      const content = _getDocumentContent(FILE)!
      const lines = content.split('\n')
      lines[lines.length - 1].should.equal('footer')
    })

    it('should create hunk with type addition', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      const hunkId = await applier.applyAddition(FILE, 2, ['new'], rgId)
      store.getHunk(hunkId)!.type.should.equal('addition')
    })
  })

  // ==================== readFile ====================

  describe('readFile', () => {
    it('should normalize CRLF to LF', async () => {
      _addDocument(FILE, 'line1\r\nline2\r\nline3')

      const content = await applier.readFile(FILE)
      content.should.equal('line1\nline2\nline3')
      content.should.not.containEql('\r')
    })

    it('should return empty content for non-registered file (mock returns empty doc)', async () => {
      // In mock environment, openTextDocument returns empty doc for unregistered paths.
      // In real VS Code, it would throw. HunkApplier.readFile has fs fallback for real errors.
      const content = await applier.readFile('/nonexistent/path.ts')
      content.should.equal('')
    })
  })

  // ==================== Bad AI input resilience ====================

  describe('Bad AI input resilience', () => {
    it('should handle AI sending empty originalLines for replacement', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      // AI sends empty originalLines — splice(idx, 0, ...newLines) = insertion
      const hunkId = await applier.applyReplacement(FILE, 2, [], ['inserted'], rgId)
      const hunk = store.getHunk(hunkId)!
      // removedLines from file: slice(1, 1+0) = empty
      hunk.removedLines.should.deepEqual([])
    })

    it('should handle AI sending empty newLines for replacement (effectively deletion)', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      const hunkId = await applier.applyReplacement(FILE, 2, ['line2'], [], rgId)
      const hunk = store.getHunk(hunkId)!
      hunk.addedLines.should.deepEqual([])
      hunk.removedLines[0].should.equal('line2')
    })

    it('should handle AI sending lines with trailing \\r', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      await applier.applyReplacement(
        FILE, 1,
        ['line1\r'],  // AI sends with \r
        ['new\r'],
        rgId
      )

      // File should still be modified (splice uses length, not content match)
      const content = _getDocumentContent(FILE)!
      content.should.containEql('new\r')
    })

    it('should handle AI sending wrong line content (mismatch)', async () => {
      _addDocument(FILE, '  function foo() {\n  return 1;\n  }')

      // AI thinks line 1 has no indent (wrong), but we still apply
      const hunkId = await applier.applyReplacement(
        FILE, 1,
        ['function foo() {'],  // WRONG: no indent
        ['function bar() {'],
        rgId
      )

      // removedLines should have ACTUAL file content (with indent)
      const hunk = store.getHunk(hunkId)!
      hunk.removedLines[0].should.equal('  function foo() {')
    })

    it('should handle AI sending originalLines count that exceeds file length', async () => {
      _addDocument(FILE, 'line1\nline2')

      // AI thinks there are 10 lines but file only has 2
      // splice handles this gracefully — removes what it can
      const hunkId = await applier.applyReplacement(
        FILE, 1,
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],  // 10 lines (overcounted)
        ['replaced'],
        rgId
      )

      // Should not crash; actualRemovedLines = what's actually in the file
      const hunk = store.getHunk(hunkId)!
      hunk.removedLines.length.should.be.lessThanOrEqual(2) // file only has 2 lines
    })

    it('should handle AI sending unicode garbage in lines', async () => {
      _addDocument(FILE, 'normal line\nline2')

      await applier.applyReplacement(
        FILE, 1,
        ['garbage'],
        ['🤖💀 model output with emoji\t\ttabs\x00null'],
        rgId
      )

      const content = _getDocumentContent(FILE)!
      content.should.containEql('🤖💀')
    })

    it('should handle file with single empty line', async () => {
      _addDocument(FILE, '')

      try {
        await applier.applyReplacement(FILE, 1, [''], ['new content'], rgId)
        // Should either work or throw cleanly
      } catch (err: any) {
        // Acceptable: throw with clear error
        err.message.should.be.a.String()
      }
    })

    it('should handle AI sending same content for replacement (no-op)', async () => {
      _addDocument(FILE, CONTENT_5_LINES)

      // AI replaces line2 with... line2 (no change)
      const hunkId = await applier.applyReplacement(FILE, 2, ['line2'], ['line2'], rgId)

      // Hunk is still created (DiffSystem's no-op detection handles this at higher level)
      const hunk = store.getHunk(hunkId)!
      hunk.removedLines.should.deepEqual(['line2'])
      hunk.addedLines.should.deepEqual(['line2'])
    })

    it('should handle very large replacement (100+ lines)', async () => {
      const bigFile = Array.from({ length: 200 }, (_, i) => `line${i + 1}`).join('\n')
      _addDocument(FILE, bigFile)

      const newLines = Array.from({ length: 150 }, (_, i) => `new${i + 1}`)
      const hunkId = await applier.applyReplacement(FILE, 50, ['line50'], newLines, rgId)

      const hunk = store.getHunk(hunkId)!
      hunk.addedLines.length.should.equal(150)
    })
  })
})

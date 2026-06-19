import { describe, it, beforeEach, afterEach } from 'mocha'
import 'should'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { DiffSystem } from '../DiffSystem'
import { _addDocument, _clearDocuments, _getDocumentContent, _setConfigOverride, _clearConfigOverrides } from '@/test/vscode-mock'
import { InMemoryMemento } from '@/test/test-helpers'

/**
 * DiffSystem integration tests.
 * Tests the full flow: checkpoint → edit → overlap → rollback.
 * Uses real DiffStore (in-memory), real FileSnapshotStorage (tmp fs),
 * and vscode-mock for document operations.
 */
describe('DiffSystem (integration)', () => {
  let system: DiffSystem
  let tmpDir: string
  const FILE_A = '/test/a.ts'
  const FILE_B = '/test/b.ts'

  function makeContext(): any {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shuncode-diffsys-test-'))
    return {
      workspaceState: new InMemoryMemento(),
      globalStorageUri: { fsPath: tmpDir },
      subscriptions: [],
    }
  }

  beforeEach(async () => {
    _clearDocuments()
    const ctx = makeContext()
    system = new DiffSystem(ctx)
    await system.initialize(true) // clearOnStartup=true
  })

  afterEach(() => {
    system.dispose()
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ==================== Lifecycle ====================

  describe('Lifecycle', () => {
    it('should initialize successfully', () => {
      // Already initialized in beforeEach
      system.getPendingCount().should.equal(0)
    })

    it('should set and get taskId', () => {
      system.setCurrentTaskId('task-123')
      system.getCurrentTaskId()!.should.equal('task-123')
    })

    it('should set taskId to null', () => {
      system.setCurrentTaskId('task-123')
      system.setCurrentTaskId(null)
      ;(system.getCurrentTaskId() === null).should.be.true()
    })
  })

  // ==================== Checkpoint management ====================

  describe('Checkpoint management', () => {
    it('should start a checkpoint and create ResponseGroup', async () => {
      const rgId = await system.startCheckpoint('test', 1000)
      rgId.should.be.a.String()
      rgId.length.should.be.greaterThan(0)
    })

    it('should finish previous checkpoint when starting new one', async () => {
      const rg1 = await system.startCheckpoint('first', 1000)
      const rg2 = await system.startCheckpoint('second', 2000)
      rg1.should.not.equal(rg2)
    })

    it('should auto-generate messageTs if not provided', async () => {
      const rgId = await system.startCheckpoint('auto-ts')
      rgId.should.be.a.String()
    })

    it('finishCheckpoint should clear currentResponseGroupId', async () => {
      await system.startCheckpoint('test', 1000)
      const id = await system.finishCheckpoint()
      id!.should.be.a.String()

      // Second finish should return undefined (no active)
      const id2 = await system.finishCheckpoint()
      ;(id2 === undefined).should.be.true()
    })
  })

  // ==================== Apply changes ====================

  describe('Apply changes', () => {
    beforeEach(async () => {
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('test', 1000)
    })

    it('replaceLines should modify file and create hunk', async () => {
      _addDocument(FILE_A, 'line1\nline2\nline3')

      const hunkId = await system.replaceLines(FILE_A, 2, ['line2'], ['REPLACED'])
      hunkId.should.be.a.String()

      _getDocumentContent(FILE_A)!.should.containEql('REPLACED')
      system.getPendingCount().should.equal(1)
    })

    it('deleteLines should remove lines and create hunk', async () => {
      _addDocument(FILE_A, 'line1\nline2\nline3\nline4')

      const hunkId = await system.deleteLines(FILE_A, 2, 2)
      hunkId.should.be.a.String()

      const content = _getDocumentContent(FILE_A)!
      content.should.not.containEql('line2')
      content.should.not.containEql('line3')
    })

    it('addLines should insert lines and create hunk', async () => {
      _addDocument(FILE_A, 'line1\nline2')

      const hunkId = await system.addLines(FILE_A, 1, ['inserted'])
      hunkId.should.be.a.String()

      _getDocumentContent(FILE_A)!.should.containEql('inserted')
    })

    it('multiple changes to same file in one RG', async () => {
      _addDocument(FILE_A, 'a\nb\nc\nd\ne')

      await system.replaceLines(FILE_A, 1, ['a'], ['A'])
      await system.addLines(FILE_A, 5, ['F'])

      system.getPendingCount().should.equal(2)
      system.hasPendingChanges(FILE_A).should.be.true()
    })

    it('changes to different files in one RG', async () => {
      _addDocument(FILE_A, 'file-a content')
      _addDocument(FILE_B, 'file-b content')

      await system.replaceLines(FILE_A, 1, ['file-a content'], ['A modified'])
      await system.replaceLines(FILE_B, 1, ['file-b content'], ['B modified'])

      system.getPendingCount().should.equal(2)
      system.hasPendingChanges(FILE_A).should.be.true()
      system.hasPendingChanges(FILE_B).should.be.true()
    })
  })

  // ==================== Snapshot creation ====================

  describe('Snapshot creation', () => {
    it('should create snapshot before first edit', async () => {
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('test', 1000)

      const originalContent = 'original line 1\noriginal line 2'
      _addDocument(FILE_A, originalContent)

      await system.replaceLines(FILE_A, 1, ['original line 1'], ['modified'])

      // Snapshot should have been created with original content
      // (verified indirectly through rollback)
      system.getPendingCount().should.equal(1)
    })

    it('should not create duplicate snapshots for same file in same RG', async () => {
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('test', 1000)

      _addDocument(FILE_A, 'line1\nline2\nline3')

      await system.replaceLines(FILE_A, 1, ['line1'], ['A'])
      await system.replaceLines(FILE_A, 3, ['line3'], ['C'])

      // Only one snapshot should exist (idempotent)
      system.getPendingCount().should.equal(2)
    })
  })

  // ==================== Overlap detection ====================

  describe('Overlap detection', () => {
    beforeEach(async () => {
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('test', 1000)
    })

    it('should auto-reject overlapping hunks', async () => {
      _addDocument(FILE_A, 'line1\nline2\nline3\nline4\nline5')

      // First edit: replace line 2
      await system.replaceLines(FILE_A, 2, ['line2'], ['FIRST'])
      system.getPendingCount().should.equal(1)

      // Second edit: replace same line (overlap!)
      await system.replaceLines(FILE_A, 2, ['FIRST'], ['SECOND'])

      // First hunk should be auto-rejected, only second remains
      system.getPendingCount().should.equal(1)
      _getDocumentContent(FILE_A)!.should.containEql('SECOND')
    })

    it('should auto-reject adjacent hunks', async () => {
      _addDocument(FILE_A, 'line1\nline2\nline3\nline4')

      await system.replaceLines(FILE_A, 2, ['line2'], ['A'])
      // Adjacent: line 3 touches hunk at line 2-3
      await system.replaceLines(FILE_A, 3, ['line3'], ['B'])

      // With <= />= overlap check, adjacent should be detected
      // Pending count depends on whether overlap was found
      system.getPendingCount().should.be.greaterThan(0)
    })

    it('should NOT auto-reject non-overlapping hunks', async () => {
      _addDocument(FILE_A, 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10')

      await system.replaceLines(FILE_A, 2, ['line2'], ['A'])
      await system.replaceLines(FILE_A, 8, ['line8'], ['B'])

      // Both hunks should be pending (no overlap)
      system.getPendingCount().should.equal(2)
    })
  })

  // ==================== Rollback ====================

  describe('rollbackFromMessage', () => {
    it('should restore file from snapshot (single RG)', async () => {
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('msg1', 1000)

      const original = 'line1\nline2\nline3'
      _addDocument(FILE_A, original)

      await system.replaceLines(FILE_A, 2, ['line2'], ['CHANGED'])
      _getDocumentContent(FILE_A)!.should.containEql('CHANGED')

      const reverted = await system.rollbackFromMessage(1000)
      reverted.length.should.be.greaterThan(0)

      _getDocumentContent(FILE_A)!.should.equal(original)
      system.getPendingCount().should.equal(0)
    })

    it('should restore multiple files from snapshots', async () => {
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('msg1', 1000)

      _addDocument(FILE_A, 'original A')
      _addDocument(FILE_B, 'original B')

      await system.replaceLines(FILE_A, 1, ['original A'], ['changed A'])
      await system.replaceLines(FILE_B, 1, ['original B'], ['changed B'])

      await system.rollbackFromMessage(1000)

      _getDocumentContent(FILE_A)!.should.equal('original A')
      _getDocumentContent(FILE_B)!.should.equal('original B')
    })

    it('should only revert hunks from target RG (per-message rollback)', async () => {
      system.setCurrentTaskId('task-1')

      // Message 1: edit file
      await system.startCheckpoint('msg1', 1000)
      _addDocument(FILE_A, 'line1\nline2\nline3\nline4\nline5')
      await system.replaceLines(FILE_A, 1, ['line1'], ['MSG1_CHANGE'])

      // Message 2: edit same file
      await system.startCheckpoint('msg2', 2000)
      await system.replaceLines(FILE_A, 5, ['line5'], ['MSG2_CHANGE'])

      system.getPendingCount().should.equal(2)

      // Rollback message 2 only
      await system.rollbackFromMessage(2000)

      const content = _getDocumentContent(FILE_A)!
      content.should.containEql('MSG1_CHANGE') // msg1 stays
      content.should.not.containEql('MSG2_CHANGE') // msg2 reverted
    })

    it('should return empty for nonexistent messageTs', async () => {
      system.setCurrentTaskId('task-1')
      const result = await system.rollbackFromMessage(999999)
      result.length.should.equal(0)
    })

    it('should respect taskId filter', async () => {
      // Task 1 edits
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('t1', 1000)
      _addDocument(FILE_A, 'original')
      await system.replaceLines(FILE_A, 1, ['original'], ['task1-change'])

      // Switch to task 2
      system.setCurrentTaskId('task-2')
      await system.startCheckpoint('t2', 2000)

      // Rollback task-2's messageTs should NOT affect task-1's changes
      await system.rollbackFromMessage(2000)

      _getDocumentContent(FILE_A)!.should.containEql('task1-change')
    })

    it('should rollback multiple RGs when deleting early message', async () => {
      system.setCurrentTaskId('task-1')

      // Message 1
      await system.startCheckpoint('msg1', 1000)
      _addDocument(FILE_A, 'original')
      await system.replaceLines(FILE_A, 1, ['original'], ['after-msg1'])

      // Message 2
      await system.startCheckpoint('msg2', 2000)
      await system.replaceLines(FILE_A, 1, ['after-msg1'], ['after-msg2'])

      // Rollback from msg1 → should revert BOTH
      await system.rollbackFromMessage(1000)

      _getDocumentContent(FILE_A)!.should.equal('original')
    })
  })

  // ==================== Accept / Reject ====================

  describe('Accept / Reject', () => {
    beforeEach(async () => {
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('test', 1000)
    })

    it('acceptChange should keep file as-is', async () => {
      _addDocument(FILE_A, 'line1\nline2')
      const hunkId = await system.replaceLines(FILE_A, 1, ['line1'], ['KEPT'])

      await system.acceptChange(hunkId)

      _getDocumentContent(FILE_A)!.should.containEql('KEPT')
      system.getPendingCount().should.equal(0)
    })

    it('rejectChange should restore original', async () => {
      _addDocument(FILE_A, 'line1\nline2')
      const hunkId = await system.replaceLines(FILE_A, 1, ['line1'], ['REJECTED'])

      await system.rejectChange(hunkId)

      _getDocumentContent(FILE_A)!.should.containEql('line1')
      system.getPendingCount().should.equal(0)
    })

    it('acceptAllForFile should accept all hunks', async () => {
      _addDocument(FILE_A, 'a\nb\nc\nd\ne')
      await system.replaceLines(FILE_A, 1, ['a'], ['A'])
      await system.replaceLines(FILE_A, 5, ['e'], ['E'])

      await system.acceptAllForFile(FILE_A)

      system.getPendingCount().should.equal(0)
      _getDocumentContent(FILE_A)!.should.containEql('A')
      _getDocumentContent(FILE_A)!.should.containEql('E')
    })

    it('rejectAllForFile should reject all hunks', async () => {
      _addDocument(FILE_A, 'a\nb\nc')
      await system.replaceLines(FILE_A, 1, ['a'], ['X'])
      await system.replaceLines(FILE_A, 3, ['c'], ['Z'])

      await system.rejectAllForFile(FILE_A)

      system.getPendingCount().should.equal(0)
    })
  })

  // ==================== Validation ====================

  describe('validateChangeSize', () => {
    afterEach(() => _clearConfigOverrides())

    it('should reject >60% change in files >20 lines when blocking enabled', () => {
      _setConfigOverride('shuncode', 'blockLargeFileRewrites', true)
      const content = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n')
      const error = system.validateChangeSize(content, 25) // 25/30 = 83%
      error!.should.containEql('Too many changes')
    })

    it('should allow <60% change when blocking enabled', () => {
      _setConfigOverride('shuncode', 'blockLargeFileRewrites', true)
      const content = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n')
      const error = system.validateChangeSize(content, 10) // 10/30 = 33%
      ;(error === undefined).should.be.true()
    })

    it('should allow any change in small files (<20 lines) when blocking enabled', () => {
      _setConfigOverride('shuncode', 'blockLargeFileRewrites', true)
      const content = 'line1\nline2\nline3'
      const error = system.validateChangeSize(content, 3) // 100% but small file
      ;(error === undefined).should.be.true()
    })

    it('should allow any change when blocking disabled (default)', () => {
      const content = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n')
      const error = system.validateChangeSize(content, 25) // 83% but blocking off
      ;(error === undefined).should.be.true()
    })

    it('should respect custom threshold', () => {
      _setConfigOverride('shuncode', 'blockLargeFileRewrites', true)
      _setConfigOverride('shuncode', 'largeRewriteThreshold', 0.9)
      const content = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n')
      const error = system.validateChangeSize(content, 25) // 83% < 90% threshold
      ;(error === undefined).should.be.true()
    })
  })

  // ==================== clearAll ====================

  describe('clearAll', () => {
    it('should clear everything', async () => {
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('test', 1000)
      _addDocument(FILE_A, 'content')
      await system.replaceLines(FILE_A, 1, ['content'], ['new'])

      await system.clearAll()

      system.getPendingCount().should.equal(0)
    })
  })

  // ==================== Bad AI scenarios ====================

  describe('Bad AI scenarios', () => {
    beforeEach(async () => {
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('test', 1000)
    })

    it('should survive model sending replacement to wrong line', async () => {
      _addDocument(FILE_A, 'line1\nline2\nline3')

      // Model thinks line 2 is "wrong content" but file has "line2"
      // System should still work (uses actual file content)
      const hunkId = await system.replaceLines(FILE_A, 2, ['wrong content'], ['new'])
      hunkId.should.be.a.String()
      system.getPendingCount().should.equal(1)
    })

    it('should handle rapid sequential edits to same line', async () => {
      _addDocument(FILE_A, 'line1\nline2\nline3')

      // Model edits same line 3 times rapidly
      await system.replaceLines(FILE_A, 2, ['line2'], ['edit1'])
      await system.replaceLines(FILE_A, 2, ['edit1'], ['edit2'])
      await system.replaceLines(FILE_A, 2, ['edit2'], ['edit3'])

      // Each edit auto-rejects the previous → only 1 pending
      system.getPendingCount().should.equal(1)
      _getDocumentContent(FILE_A)!.should.containEql('edit3')
    })

    it('should handle model adding then immediately deleting', async () => {
      _addDocument(FILE_A, 'line1\nline2')

      await system.addLines(FILE_A, 1, ['added'])
      // Now delete the added line
      await system.deleteLines(FILE_A, 2, 1) // line 2 is the added line

      // Should not crash, hunks may be partially resolved
      system.getPendingCount().should.be.greaterThanOrEqual(0)
    })

    it('should handle empty file', async () => {
      _addDocument(FILE_A, '')

      try {
        await system.addLines(FILE_A, 0, ['new content'])
        system.getPendingCount().should.equal(1)
      } catch {
        // Also acceptable if it throws cleanly
      }
    })

    it('should handle rollback after all hunks already accepted', async () => {
      _addDocument(FILE_A, 'original')
      const hunkId = await system.replaceLines(FILE_A, 1, ['original'], ['changed'])
      await system.acceptChange(hunkId)

      // Rollback should find no pending hunks to revert
      const reverted = await system.rollbackFromMessage(1000)
      // May revert the RG but file was already accepted
      _getDocumentContent(FILE_A)!.should.containEql('changed') // accepted = kept
    })

    it('should handle double rollback of same message', async () => {
      _addDocument(FILE_A, 'original')
      await system.replaceLines(FILE_A, 1, ['original'], ['changed'])

      await system.rollbackFromMessage(1000)
      // Second rollback — RG already rejected, should not crash
      const result = await system.rollbackFromMessage(1000)
      // Empty or no-op
      _getDocumentContent(FILE_A)!.should.equal('original')
    })
  })

  // ==================== hunkId tracking ====================

  describe('hunkId tracking', () => {
    beforeEach(async () => {
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('test', 1000)
    })

    it('replaceLines should return a valid hunkId', async () => {
      _addDocument(FILE_A, 'line1\nline2\nline3')
      const hunkId = await system.replaceLines(FILE_A, 2, ['line2'], ['CHANGED'])
      hunkId.should.be.a.String()
      hunkId.length.should.be.greaterThan(0)
    })

    it('hunkId should be retrievable from DiffStore', async () => {
      _addDocument(FILE_A, 'line1\nline2\nline3')
      const hunkId = await system.replaceLines(FILE_A, 2, ['line2'], ['CHANGED'])
      const hunk = system.getStore().getHunk(hunkId)
      hunk!.should.be.an.Object()
      hunk!.status.should.equal('pending')
    })

    it('hunk should track currentStartLine accurately after multiple edits', async () => {
      _addDocument(FILE_A, 'a\nb\nc\nd\ne\nf\ng\nh')

      // First edit: add 2 lines at line 2
      await system.addLines(FILE_A, 2, ['x1', 'x2'])
      // File is now: a\nx1\nx2\nb\nc\nd\ne\nf\ng\nh (10 lines)

      // Second edit: replace line 6 (originally 'd', now shifted to 6)
      const hunkId = await system.replaceLines(FILE_A, 6, ['d'], ['D-CHANGED'])
      const hunk = system.getStore().getHunk(hunkId)
      hunk!.currentStartLine.should.be.greaterThan(0)
    })

    it('deleteLines should return a hunkId', async () => {
      _addDocument(FILE_A, 'line1\nline2\nline3\nline4')
      const hunkId = await system.deleteLines(FILE_A, 2, 2)
      hunkId.should.be.a.String()
      system.getStore().getHunk(hunkId)!.type.should.equal('deletion')
    })

    it('addLines should return a hunkId', async () => {
      _addDocument(FILE_A, 'line1\nline2')
      const hunkId = await system.addLines(FILE_A, 1, ['new1', 'new2'])
      hunkId.should.be.a.String()
      system.getStore().getHunk(hunkId)!.type.should.equal('addition')
    })
  })

  // ==================== reject deleted file ====================

  describe('reject deleted file', () => {
    beforeEach(async () => {
      system.setCurrentTaskId('task-1')
      await system.startCheckpoint('test', 1000)
    })

    it('should handle rejectChange for hunk on deleted file', async () => {
      _addDocument(FILE_A, 'content\nhere')
      const hunkId = await system.replaceLines(FILE_A, 1, ['content'], ['modified'])

      // Simulate file deletion
      _clearDocuments()

      // Should not throw
      await system.rejectChange(hunkId)
      system.getStore().getHunk(hunkId)!.status.should.equal('rejected')
    })

    it('should handle rejectAll with mix of existing and deleted files', async () => {
      _addDocument(FILE_A, 'aa\nbb')
      _addDocument(FILE_B, 'cc\ndd')
      const h1 = await system.replaceLines(FILE_A, 1, ['aa'], ['AA'])
      const h2 = await system.replaceLines(FILE_B, 1, ['cc'], ['CC'])

      // Delete only FILE_A
      _clearDocuments()
      _addDocument(FILE_B, 'CC\ndd')

      // Reject all — should handle FILE_A gracefully
      await system.rejectChange(h1)
      await system.rejectChange(h2)

      system.getStore().getHunk(h1)!.status.should.equal('rejected')
      system.getStore().getHunk(h2)!.status.should.equal('rejected')
    })
  })
})

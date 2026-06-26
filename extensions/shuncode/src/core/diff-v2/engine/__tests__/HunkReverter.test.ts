import { describe, it, beforeEach } from 'mocha'
import 'should'
import { HunkReverter } from '../HunkReverter'
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

describe('HunkReverter', () => {
  let store: DiffStore
  let snapshotStorage: FileSnapshotStorage
  let positionTracker: PositionTracker
  let editGuard: SystemEditGuard
  let applier: HunkApplier
  let reverter: HunkReverter
  let tmpDir: string
  let rgId: string

  const FILE = '/test/file.ts'

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shuncode-reverter-test-'))
    store = new DiffStore(new InMemoryMemento() as any)
    snapshotStorage = new FileSnapshotStorage(tmpDir)
    await snapshotStorage.initialize()
    positionTracker = new PositionTracker(store)
    editGuard = new SystemEditGuard()
    applier = new HunkApplier(store, snapshotStorage, positionTracker, editGuard)
    reverter = new HunkReverter(store, snapshotStorage, positionTracker, editGuard)

    rgId = store.createResponseGroup(Date.now(), 'test')
    _clearDocuments()
  })

  // ==================== reject replacement ====================

  describe('reject replacement', () => {
    it('should restore original content', async () => {
      _addDocument(FILE, 'line1\nline2\nline3')
      const hunkId = await applier.applyReplacement(FILE, 2, ['line2'], ['CHANGED'], rgId)

      _getDocumentContent(FILE)!.should.containEql('CHANGED')

      await reverter.reject(hunkId)

      const content = _getDocumentContent(FILE)!
      content.should.containEql('line2')
      content.should.not.containEql('CHANGED')
    })

    it('should restore multi-line replacement correctly', async () => {
      _addDocument(FILE, 'a\nb\nc\nd\ne')
      const hunkId = await applier.applyReplacement(FILE, 2, ['b', 'c'], ['X', 'Y', 'Z'], rgId)

      await reverter.reject(hunkId)

      const lines = _getDocumentContent(FILE)!.split('\n')
      lines.should.deepEqual(['a', 'b', 'c', 'd', 'e'])
    })

    it('should update hunk status to rejected', async () => {
      _addDocument(FILE, 'line1\nline2')
      const hunkId = await applier.applyReplacement(FILE, 1, ['line1'], ['new'], rgId)

      await reverter.reject(hunkId)

      store.getHunk(hunkId)!.status.should.equal('rejected')
    })

    it('should use \\n for WorkspaceEdit (not \\r\\n)', async () => {
      // Even on "CRLF" files, reverter should use \n for applyEdit
      _addDocument(FILE, 'line1\nline2\nline3')
      const hunkId = await applier.applyReplacement(FILE, 2, ['line2'], ['changed'], rgId)

      await reverter.reject(hunkId)

      const content = _getDocumentContent(FILE)!
      content.should.not.containEql('\r') // No \r in content
    })

    it('should strip trailing \\r from removedLines', async () => {
      // Simulate stored lines with \r (from CRLF file)
      _addDocument(FILE, 'line1\nline2\nline3')
      const hunkId = await applier.applyReplacement(FILE, 2, ['line2'], ['new'], rgId)

      // Manually add \r to stored removedLines (simulating CRLF artifact)
      const hunk = store.getHunk(hunkId)!
      store.updateHunk(hunkId, {
        ...hunk,
        removedLines: ['line2\r'],
      })

      await reverter.reject(hunkId)

      const content = _getDocumentContent(FILE)!
      content.should.containEql('line2')
      content.should.not.containEql('line2\r')
    })
  })

  // ==================== reject deletion ====================

  describe('reject deletion', () => {
    it('should restore deleted lines', async () => {
      _addDocument(FILE, 'line1\nline2\nline3\nline4')
      const { hunkId } = await applier.applyDeletion(FILE, 2, 2, rgId)

      _getDocumentContent(FILE)!.should.not.containEql('line2')

      await reverter.reject(hunkId)

      const content = _getDocumentContent(FILE)!
      content.should.containEql('line2')
      content.should.containEql('line3')
    })

    it('should mark hunk as rejected', async () => {
      _addDocument(FILE, 'a\nb\nc')
      const { hunkId } = await applier.applyDeletion(FILE, 2, 1, rgId)

      await reverter.reject(hunkId)
      store.getHunk(hunkId)!.status.should.equal('rejected')
    })
  })

  // ==================== reject addition ====================

  describe('reject addition', () => {
    it('should remove added lines', async () => {
      _addDocument(FILE, 'line1\nline2\nline3')
      const hunkId = await applier.applyAddition(FILE, 2, ['inserted1', 'inserted2'], rgId)

      _getDocumentContent(FILE)!.should.containEql('inserted1')

      await reverter.reject(hunkId)

      const content = _getDocumentContent(FILE)!
      content.should.not.containEql('inserted1')
      content.should.not.containEql('inserted2')
    })
  })

  // ==================== accept ====================

  describe('accept', () => {
    it('should NOT modify file content', async () => {
      _addDocument(FILE, 'line1\nline2')
      const hunkId = await applier.applyReplacement(FILE, 1, ['line1'], ['ACCEPTED'], rgId)
      const contentAfterApply = _getDocumentContent(FILE)!

      await reverter.accept(hunkId)

      _getDocumentContent(FILE)!.should.equal(contentAfterApply) // unchanged
    })

    it('should update status to accepted', async () => {
      _addDocument(FILE, 'line1')
      const hunkId = await applier.applyReplacement(FILE, 1, ['line1'], ['new'], rgId)

      await reverter.accept(hunkId)
      store.getHunk(hunkId)!.status.should.equal('accepted')
    })
  })

  // ==================== error handling ====================

  describe('error handling', () => {
    it('should throw for nonexistent hunk', async () => {
      try {
        await reverter.reject('nonexistent')
        throw new Error('Should have thrown')
      } catch (err: any) {
        err.message.should.containEql('Hunk not found')
      }
    })

    it('should throw for already accepted hunk', async () => {
      _addDocument(FILE, 'line1')
      const hunkId = await applier.applyReplacement(FILE, 1, ['line1'], ['new'], rgId)
      await reverter.accept(hunkId)

      try {
        await reverter.reject(hunkId)
        throw new Error('Should have thrown')
      } catch (err: any) {
        err.message.should.containEql('already accepted')
      }
    })

    it('should throw for already rejected hunk', async () => {
      _addDocument(FILE, 'line1')
      const hunkId = await applier.applyReplacement(FILE, 1, ['line1'], ['new'], rgId)
      await reverter.reject(hunkId)

      try {
        await reverter.reject(hunkId)
        throw new Error('Should have thrown')
      } catch (err: any) {
        err.message.should.containEql('already rejected')
      }
    })
  })

  // ==================== bulk operations ====================

  describe('bulk operations', () => {
    it('rejectAllForFile should reject all pending hunks bottom-to-top', async () => {
      _addDocument(FILE, 'a\nb\nc\nd\ne')
      const h1 = await applier.applyReplacement(FILE, 1, ['a'], ['A'], rgId)
      const h2 = await applier.applyReplacement(FILE, 3, ['c'], ['C'], rgId)

      const count = await reverter.rejectAllForFile(FILE)
      count.should.equal(2)

      store.getHunk(h1)!.status.should.equal('rejected')
      store.getHunk(h2)!.status.should.equal('rejected')
    })

    it('acceptAllForFile should accept all pending hunks', async () => {
      _addDocument(FILE, 'a\nb\nc')
      const h1 = await applier.applyReplacement(FILE, 1, ['a'], ['A'], rgId)
      const h2 = await applier.applyReplacement(FILE, 3, ['c'], ['C'], rgId)

      const count = await reverter.acceptAllForFile(FILE)
      count.should.equal(2)

      store.getHunk(h1)!.status.should.equal('accepted')
      store.getHunk(h2)!.status.should.equal('accepted')
    })

    it('rejectAllForResponseGroup should reject only hunks from that RG', async () => {
      _addDocument(FILE, 'a\nb\nc\nd')

      const rg1 = store.createResponseGroup(1000, 'rg1')
      const rg2 = store.createResponseGroup(2000, 'rg2')

      const h1 = await applier.applyReplacement(FILE, 1, ['a'], ['A'], rg1)
      const h2 = await applier.applyReplacement(FILE, 3, ['c'], ['C'], rg2)

      await reverter.rejectAllForResponseGroup(rg1)

      store.getHunk(h1)!.status.should.equal('rejected')
      store.getHunk(h2)!.status.should.equal('pending') // untouched
    })
  })

  // ==================== parent status cascade ====================

  describe('parent status cascade', () => {
    it('all hunks accepted → RG status accepted', async () => {
      _addDocument(FILE, 'a\nb')
      const h1 = await applier.applyReplacement(FILE, 1, ['a'], ['A'], rgId)

      await reverter.accept(h1)

      store.getResponseGroup(rgId)!.status.should.equal('accepted')
    })

    it('all hunks rejected → RG status rejected', async () => {
      _addDocument(FILE, 'a\nb')
      const h1 = await applier.applyReplacement(FILE, 1, ['a'], ['A'], rgId)

      await reverter.reject(h1)

      store.getResponseGroup(rgId)!.status.should.equal('rejected')
    })

    it('mixed accept/reject → RG status partial', async () => {
      _addDocument(FILE, 'a\nb\nc\nd')
      const h1 = await applier.applyReplacement(FILE, 1, ['a'], ['A'], rgId)
      const h2 = await applier.applyReplacement(FILE, 3, ['c'], ['C'], rgId)

      await reverter.accept(h1)
      await reverter.reject(h2)

      const rg = store.getResponseGroup(rgId)!
      rg.status.should.equal('partial')
    })

    it('pending hunks remain → no RG status change', async () => {
      _addDocument(FILE, 'a\nb\nc\nd')
      const h1 = await applier.applyReplacement(FILE, 1, ['a'], ['A'], rgId)
      await applier.applyReplacement(FILE, 3, ['c'], ['C'], rgId) // h2 stays pending

      await reverter.accept(h1)

      store.getResponseGroup(rgId)!.status.should.equal('active') // h2 still pending
    })
  })

  // ==================== Bad AI input resilience ====================

  describe('Bad AI input resilience', () => {
    it('should handle reject of hunk with empty removedLines (was addition)', async () => {
      _addDocument(FILE, 'line1\nline2')
      const hunkId = await applier.applyAddition(FILE, 1, ['new line'], rgId)

      // reject should remove the added line
      await reverter.reject(hunkId)
      const content = _getDocumentContent(FILE)!
      content.should.not.containEql('new line')
    })

    it('should handle reject when file has been externally modified', async () => {
      _addDocument(FILE, 'original\nline2')
      const hunkId = await applier.applyReplacement(FILE, 1, ['original'], ['changed'], rgId)

      // "External" modification: change content directly
      _addDocument(FILE, 'something else\nline2')

      // Reject should still write removedLines (from hunk data)
      // It may not perfectly restore, but should not crash
      try {
        await reverter.reject(hunkId)
        // If it doesn't crash, that's acceptable
      } catch {
        // If it throws, also acceptable for corrupted state
      }

      store.getHunk(hunkId)!.status.should.equal('rejected')
    })

    it('should gracefully handle reject when file has been deleted', async () => {
      _addDocument(FILE, 'line1\nline2\nline3')
      const hunkId = await applier.applyReplacement(FILE, 2, ['line2'], ['CHANGED'], rgId)

      // Simulate file deletion: remove from document store
      _clearDocuments()

      // Should not throw — gracefully marks as rejected
      await reverter.reject(hunkId)

      store.getHunk(hunkId)!.status.should.equal('rejected')
    })

    it('should reject all hunks for deleted file without crashing', async () => {
      _addDocument(FILE, 'a\nb\nc\nd\ne')
      const h1 = await applier.applyReplacement(FILE, 1, ['a'], ['A'], rgId)
      const h2 = await applier.applyReplacement(FILE, 3, ['c'], ['C'], rgId)

      // Simulate file deletion
      _clearDocuments()

      // rejectAllForFile should handle missing file gracefully
      const count = await reverter.rejectAllForFile(FILE)
      count.should.equal(2)

      store.getHunk(h1)!.status.should.equal('rejected')
      store.getHunk(h2)!.status.should.equal('rejected')
    })

    it('should cascade RG status after rejecting deleted file hunks', async () => {
      _addDocument(FILE, 'line1\nline2')
      const hunkId = await applier.applyReplacement(FILE, 1, ['line1'], ['new'], rgId)

      _clearDocuments()
      await reverter.reject(hunkId)

      store.getHunk(hunkId)!.status.should.equal('rejected')
      store.getResponseGroup(rgId)!.status.should.equal('rejected')
    })
  })
})

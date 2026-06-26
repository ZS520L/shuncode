import { describe, it, beforeEach, afterEach } from 'mocha'
import 'should'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { FileSnapshotStorage } from '../FileSnapshotStorage'

describe('FileSnapshotStorage', () => {
  let storage: FileSnapshotStorage
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shuncode-snapshot-test-'))
    storage = new FileSnapshotStorage(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  async function initStorage() {
    await storage.initialize()
  }

  // ==================== Save ====================

  describe('saveBeforeAI', () => {
    it('should save snapshot with correct fields', async () => {
      await initStorage()
      const id = storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, 'file content here')
      id.should.startWith('snap-')
    })

    it('should be idempotent: same (fsPath, rgId) returns same id', async () => {
      await initStorage()
      const id1 = storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, 'content')
      const id2 = storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, 'content')
      id1.should.equal(id2)
    })

    it('should create different snapshots for different rgIds', async () => {
      await initStorage()
      const id1 = storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, 'content v1')
      const id2 = storage.saveBeforeAI('/test/file.ts', 'rg-2', 2000, 'content v2')
      id1.should.not.equal(id2)
    })

    it('should preserve content exactly', async () => {
      await initStorage()
      const content = '  line1\n  line2\n  line3\n'
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, content)

      const snapshot = storage.getSnapshotForRollback('/test/file.ts', 1000)
      snapshot!.content.should.equal(content)
    })

    it('should persist to disk', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, 'disk content')

      // Check that a .snapshot file exists in the rg directory
      const rgDir = path.join(tmpDir, 'snapshots', 'rg-1')
      fs.existsSync(rgDir).should.be.true()
      const files = fs.readdirSync(rgDir)
      files.length.should.equal(1)
      files[0].should.endWith('.snapshot')
    })
  })

  // ==================== Lookup ====================

  describe('getSnapshotForRollback', () => {
    it('should find exact match by messageTs', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, 'v1')

      const snap = storage.getSnapshotForRollback('/test/file.ts', 1000)
      snap!.content.should.equal('v1')
      snap!.messageTs.should.equal(1000)
    })

    it('should find first >= match when no exact', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, 'v1')
      storage.saveBeforeAI('/test/file.ts', 'rg-2', 2000, 'v2')

      const snap = storage.getSnapshotForRollback('/test/file.ts', 1500)
      snap!.content.should.equal('v2') // 2000 >= 1500
    })

    it('should fallback to closest < match when no >= match', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, 'v1')

      const snap = storage.getSnapshotForRollback('/test/file.ts', 2000)
      snap!.content.should.equal('v1') // 1000 < 2000, closest before
    })

    it('should return undefined when no snapshots exist', async () => {
      await initStorage()
      const snap = storage.getSnapshotForRollback('/test/file.ts', 1000)
      ;(snap === undefined).should.be.true()
    })

    it('should handle path normalization: backslash vs forward slash', async () => {
      await initStorage()
      storage.saveBeforeAI('D:\\Users\\file.ts', 'rg-1', 1000, 'content')

      // Look up with forward slashes
      const snap = storage.getSnapshotForRollback('D:/Users/file.ts', 1000)
      snap!.content.should.equal('content')
    })

    it('should handle path normalization: case insensitive', async () => {
      await initStorage()
      storage.saveBeforeAI('D:\\Users\\File.ts', 'rg-1', 1000, 'content')

      const snap = storage.getSnapshotForRollback('d:\\users\\file.ts', 1000)
      snap!.content.should.equal('content')
    })

    it('should return correct snapshot when multiple exist', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 100, 'v100')
      storage.saveBeforeAI('/test/file.ts', 'rg-2', 200, 'v200')
      storage.saveBeforeAI('/test/file.ts', 'rg-3', 300, 'v300')

      storage.getSnapshotForRollback('/test/file.ts', 200)!.content.should.equal('v200')
      storage.getSnapshotForRollback('/test/file.ts', 250)!.content.should.equal('v300')
      storage.getSnapshotForRollback('/test/file.ts', 400)!.content.should.equal('v300') // fallback <
    })
  })

  // ==================== Other lookups ====================

  describe('hasSnapshotForResponseGroup', () => {
    it('should return true when snapshot exists', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, 'content')
      storage.hasSnapshotForResponseGroup('/test/file.ts', 'rg-1').should.be.true()
    })

    it('should return false when no snapshot exists', async () => {
      await initStorage()
      storage.hasSnapshotForResponseGroup('/test/file.ts', 'rg-1').should.be.false()
    })
  })

  describe('getSnapshotCount', () => {
    it('should return correct count', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, 'v1')
      storage.saveBeforeAI('/test/file.ts', 'rg-2', 2000, 'v2')
      storage.getSnapshotCount('/test/file.ts').should.equal(2)
    })

    it('should return 0 for unknown file', async () => {
      await initStorage()
      storage.getSnapshotCount('/unknown.ts').should.equal(0)
    })
  })

  // ==================== Delete ====================

  describe('deleteSnapshotsFromMessageTs', () => {
    it('should remove all snapshots with messageTs >= target', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 100, 'v100')
      storage.saveBeforeAI('/test/file.ts', 'rg-2', 200, 'v200')
      storage.saveBeforeAI('/test/file.ts', 'rg-3', 300, 'v300')

      storage.deleteSnapshotsFromMessageTs('/test/file.ts', 200)
      storage.getSnapshotCount('/test/file.ts').should.equal(1) // only v100 remains
      storage.getSnapshotForRollback('/test/file.ts', 100)!.content.should.equal('v100')
    })

    it('should keep snapshots with messageTs < target', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 100, 'keep')
      storage.saveBeforeAI('/test/file.ts', 'rg-2', 200, 'remove')

      storage.deleteSnapshotsFromMessageTs('/test/file.ts', 200)
      storage.getSnapshotForRollback('/test/file.ts', 100)!.content.should.equal('keep')
    })
  })

  describe('cleanupForFile', () => {
    it('should remove ALL snapshots for a file', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 100, 'v1')
      storage.saveBeforeAI('/test/file.ts', 'rg-2', 200, 'v2')

      storage.cleanupForFile('/test/file.ts')
      storage.getSnapshotCount('/test/file.ts').should.equal(0)
    })
  })

  // ==================== Disk persistence ====================

  describe('Disk persistence (round-trip)', () => {
    it('should restore snapshots from disk after re-initialize', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/file.ts', 'rg-1', 1000, 'persisted content')

      // Create new storage instance pointing to same directory
      const storage2 = new FileSnapshotStorage(tmpDir)
      await storage2.initialize()

      const snap = storage2.getSnapshotForRollback('/test/file.ts', 1000)
      snap!.content.should.equal('persisted content')
      snap!.messageTs.should.equal(1000)
    })

    it('should handle corrupt snapshot files gracefully', async () => {
      await initStorage()

      // Write a corrupt snapshot file
      const rgDir = path.join(tmpDir, 'snapshots', 'corrupt-rg')
      fs.mkdirSync(rgDir, { recursive: true })
      fs.writeFileSync(path.join(rgDir, 'corrupt.snapshot'), 'not-json\ncorrupt data')

      // Re-initialize should not crash
      const storage2 = new FileSnapshotStorage(tmpDir)
      await storage2.initialize() // should not throw
    })

    it('should handle missing snapshots directory', async () => {
      // Don't create directory — initialize should create it
      const freshDir = path.join(tmpDir, 'fresh')
      const freshStorage = new FileSnapshotStorage(freshDir)
      await freshStorage.initialize() // should not throw
      fs.existsSync(path.join(freshDir, 'snapshots')).should.be.true()
    })
  })

  // ==================== Edge cases ====================

  describe('Edge cases', () => {
    it('should handle empty file content', async () => {
      await initStorage()
      storage.saveBeforeAI('/test/empty.ts', 'rg-1', 1000, '')
      const snap = storage.getSnapshotForRollback('/test/empty.ts', 1000)
      snap!.content.should.equal('')
    })

    it('should handle unicode content (кириллица)', async () => {
      await initStorage()
      const content = '# Тестовый файл\n- Проект: Aquanet\n- Версия: 1.0.0\n'
      storage.saveBeforeAI('/test/unicode.md', 'rg-1', 1000, content)
      storage.getSnapshotForRollback('/test/unicode.md', 1000)!.content.should.equal(content)
    })

    it('should handle file path with spaces', async () => {
      await initStorage()
      storage.saveBeforeAI('/my project/test file.ts', 'rg-1', 1000, 'content')
      storage.getSnapshotForRollback('/my project/test file.ts', 1000)!.content.should.equal('content')
    })

    it('should handle large content', async () => {
      await initStorage()
      const largeContent = 'x'.repeat(100_000) // 100KB
      storage.saveBeforeAI('/test/large.ts', 'rg-1', 1000, largeContent)
      storage.getSnapshotForRollback('/test/large.ts', 1000)!.content.length.should.equal(100_000)
    })

    it('should handle content with newlines in various formats', async () => {
      await initStorage()
      const content = 'line1\r\nline2\nline3\rline4'
      storage.saveBeforeAI('/test/mixed.ts', 'rg-1', 1000, content)
      storage.getSnapshotForRollback('/test/mixed.ts', 1000)!.content.should.equal(content)
    })
  })
})

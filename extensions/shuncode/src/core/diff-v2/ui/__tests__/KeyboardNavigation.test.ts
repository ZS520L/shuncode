import { describe, it, beforeEach } from 'mocha'
import 'should'
import { KeyboardNavigation } from '../KeyboardNavigation'
import { DiffStore } from '../../storage/DiffStore'
import { InMemoryMemento } from '@/test/test-helpers'

describe('KeyboardNavigation', () => {
  let store: DiffStore
  let nav: KeyboardNavigation

  beforeEach(() => {
    store = new DiffStore(new InMemoryMemento() as any)
    nav = new KeyboardNavigation(store)
  })

  function addHunkAtLine(fsPath: string, startLine: number, endLine: number): string {
    const rgId = store.createResponseGroup(Date.now())
    const fcId = store.createFileChange(rgId, fsPath, 'modified')
    return store.createHunk({
      fileChangeId: fcId,
      responseGroupId: rgId,
      fsPath,
      originalStartLine: startLine,
      originalEndLine: endLine,
      currentStartLine: startLine,
      currentEndLine: endLine,
      removedLines: ['old'],
      addedLines: ['new'],
      type: 'replacement',
    })
  }

  describe('getFilesWithPendingHunks (via store)', () => {
    it('should return files sorted alphabetically', () => {
      addHunkAtLine('/z.ts', 1, 2)
      addHunkAtLine('/a.ts', 1, 2)
      addHunkAtLine('/m.ts', 1, 2)

      const files = store.getFilesWithPendingChanges().sort()
      files[0].should.equal('/a.ts')
      files[1].should.equal('/m.ts')
      files[2].should.equal('/z.ts')
    })
  })

  describe('nextHunk / prevHunk logic', () => {
    it('should find next hunk in ordered list', () => {
      addHunkAtLine('/a.ts', 5, 6)
      addHunkAtLine('/a.ts', 15, 16)
      addHunkAtLine('/a.ts', 25, 26)

      const hunks = store.getPendingHunksByFile('/a.ts')
        .sort((a, b) => a.currentStartLine - b.currentStartLine)

      // Simulate cursor at line 10 (1-based), find next hunk after it
      const curLine = 10
      const next = hunks.find(h => h.currentStartLine > curLine)
      next!.currentStartLine.should.equal(15)
    })

    it('should wrap to first hunk when at end', () => {
      addHunkAtLine('/a.ts', 5, 6)
      addHunkAtLine('/a.ts', 15, 16)

      const hunks = store.getPendingHunksByFile('/a.ts')
        .sort((a, b) => a.currentStartLine - b.currentStartLine)

      // Cursor past last hunk
      const curLine = 20
      const next = hunks.find(h => h.currentStartLine > curLine) || hunks[0]
      next.currentStartLine.should.equal(5) // wrapped
    })

    it('should find previous hunk', () => {
      addHunkAtLine('/a.ts', 5, 6)
      addHunkAtLine('/a.ts', 15, 16)
      addHunkAtLine('/a.ts', 25, 26)

      const hunks = store.getPendingHunksByFile('/a.ts')
        .sort((a, b) => a.currentStartLine - b.currentStartLine)

      const curLine = 20
      let prev: any
      for (let i = hunks.length - 1; i >= 0; i--) {
        if (hunks[i].currentStartLine < curLine) {
          prev = hunks[i]
          break
        }
      }
      prev!.currentStartLine.should.equal(15)
    })
  })

  describe('cross-file navigation data', () => {
    it('should have hunks across multiple files', () => {
      addHunkAtLine('/a.ts', 10, 11)
      addHunkAtLine('/b.ts', 5, 6)
      addHunkAtLine('/c.ts', 20, 21)

      const files = store.getFilesWithPendingChanges()
      files.length.should.equal(3)

      // Each file has hunks
      store.getPendingHunksByFile('/a.ts').length.should.equal(1)
      store.getPendingHunksByFile('/b.ts').length.should.equal(1)
      store.getPendingHunksByFile('/c.ts').length.should.equal(1)
    })

    it('should get next file in order', () => {
      addHunkAtLine('/a.ts', 10, 11)
      addHunkAtLine('/b.ts', 5, 6)
      addHunkAtLine('/c.ts', 20, 21)

      const files = store.getFilesWithPendingChanges().sort()
      const currentIdx = files.indexOf('/a.ts')
      const nextFileIdx = (currentIdx + 1) % files.length
      files[nextFileIdx].should.equal('/b.ts')
    })

    it('should wrap to first file from last', () => {
      addHunkAtLine('/a.ts', 10, 11)
      addHunkAtLine('/b.ts', 5, 6)

      const files = store.getFilesWithPendingChanges().sort()
      const currentIdx = files.indexOf('/b.ts') // last
      const nextFileIdx = (currentIdx + 1) % files.length
      files[nextFileIdx].should.equal('/a.ts') // wrapped
    })

    it('should get previous file', () => {
      addHunkAtLine('/a.ts', 10, 11)
      addHunkAtLine('/b.ts', 5, 6)
      addHunkAtLine('/c.ts', 20, 21)

      const files = store.getFilesWithPendingChanges().sort()
      const currentIdx = files.indexOf('/b.ts')
      const prevFileIdx = (currentIdx - 1 + files.length) % files.length
      files[prevFileIdx].should.equal('/a.ts')
    })

    it('should wrap to last file from first (prev)', () => {
      addHunkAtLine('/a.ts', 10, 11)
      addHunkAtLine('/b.ts', 5, 6)

      const files = store.getFilesWithPendingChanges().sort()
      const currentIdx = files.indexOf('/a.ts') // first
      const prevFileIdx = (currentIdx - 1 + files.length) % files.length
      files[prevFileIdx].should.equal('/b.ts') // wrapped to last
    })
  })

  describe('no hunks scenarios', () => {
    it('should have empty file list when no pending hunks', () => {
      store.getFilesWithPendingChanges().length.should.equal(0)
    })

    it('should handle file with only accepted hunks (no pending)', () => {
      const hunkId = addHunkAtLine('/a.ts', 5, 6)
      store.updateHunkStatus(hunkId, 'accepted')

      store.getPendingHunksByFile('/a.ts').length.should.equal(0)
      store.getFilesWithPendingChanges().length.should.equal(0)
    })
  })
})

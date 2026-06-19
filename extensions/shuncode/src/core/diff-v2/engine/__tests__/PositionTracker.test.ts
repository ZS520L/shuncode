import { describe, it, beforeEach } from 'mocha'
import 'should'
import { PositionTracker } from '../PositionTracker'
import { DiffStore } from '../../storage/DiffStore'
import { InMemoryMemento } from '@/test/test-helpers'

describe('PositionTracker', () => {
  let store: DiffStore
  let tracker: PositionTracker
  const FILE = '/test/file.ts'

  beforeEach(() => {
    store = new DiffStore(new InMemoryMemento() as any)
    tracker = new PositionTracker(store)
  })

  function createHunk(startLine: number, endLine: number, id?: string): string {
    const rgId = store.createResponseGroup(Date.now(), 'test')
    const fcId = store.createFileChange(rgId, FILE, 'modified')
    return store.createHunk({
      fileChangeId: fcId,
      responseGroupId: rgId,
      fsPath: FILE,
      originalStartLine: startLine,
      originalEndLine: endLine,
      currentStartLine: startLine,
      currentEndLine: endLine,
      removedLines: ['old'],
      addedLines: ['new'],
      type: 'replacement',
    })
  }

  describe('recalculate — positive delta (lines added)', () => {
    it('should shift hunks below the edit point', () => {
      // Hunk at lines 10-12
      const hunkId = createHunk(10, 12)
      // Insert 3 lines at line 5
      const updates = tracker.recalculate(FILE, 5, 5, 3)

      updates.length.should.equal(1)
      const hunk = store.getHunk(hunkId)!
      hunk.currentStartLine.should.equal(13) // 10 + 3
      hunk.currentEndLine.should.equal(15) // 12 + 3
    })

    it('should NOT shift hunks above the edit point', () => {
      const hunkId = createHunk(3, 5)
      // Insert at line 10 (below the hunk)
      tracker.recalculate(FILE, 10, 10, 2)

      const hunk = store.getHunk(hunkId)!
      hunk.currentStartLine.should.equal(3) // unchanged
      hunk.currentEndLine.should.equal(5) // unchanged
    })
  })

  describe('recalculate — negative delta (lines removed)', () => {
    it('should shift hunks below the edit point upward', () => {
      const hunkId = createHunk(20, 22)
      // Remove 5 lines starting at line 5
      tracker.recalculate(FILE, 5, 10, -5)

      const hunk = store.getHunk(hunkId)!
      hunk.currentStartLine.should.equal(15) // 20 - 5
      hunk.currentEndLine.should.equal(17) // 22 - 5
    })
  })

  describe('recalculate — zero delta', () => {
    it('should return empty array and not modify hunks', () => {
      const hunkId = createHunk(10, 12)
      const updates = tracker.recalculate(FILE, 5, 5, 0)

      updates.should.be.empty()
      const hunk = store.getHunk(hunkId)!
      hunk.currentStartLine.should.equal(10)
      hunk.currentEndLine.should.equal(12)
    })
  })

  describe('recalculate — excludeHunkId', () => {
    it('should NOT shift the triggering hunk', () => {
      const hunkId = createHunk(10, 12)
      // Edit at line 5, but exclude our hunk
      tracker.recalculate(FILE, 5, 5, 3, hunkId)

      const hunk = store.getHunk(hunkId)!
      hunk.currentStartLine.should.equal(10) // unchanged because excluded
    })

    it('should still shift other hunks', () => {
      const hunk1 = createHunk(10, 12)
      const hunk2 = createHunk(20, 22)
      // Edit at line 5, exclude hunk1
      tracker.recalculate(FILE, 5, 5, 3, hunk1)

      store.getHunk(hunk1)!.currentStartLine.should.equal(10) // excluded
      store.getHunk(hunk2)!.currentStartLine.should.equal(23) // shifted
    })
  })

  describe('recalculate — overlapping edit', () => {
    it('should update endLine only for overlapping hunk', () => {
      const hunkId = createHunk(5, 10)
      // Edit overlaps: remove 2 lines within the hunk range
      tracker.recalculate(FILE, 6, 8, -2)

      const hunk = store.getHunk(hunkId)!
      hunk.currentStartLine.should.equal(5) // start unchanged
      hunk.currentEndLine.should.equal(8) // 10 - 2
    })
  })

  describe('recalculate — only affects same file', () => {
    it('should not shift hunks in other files', () => {
      const rgId = store.createResponseGroup(Date.now(), 'test')
      const fcId = store.createFileChange(rgId, '/other/file.ts', 'modified')
      const hunkId = store.createHunk({
        fileChangeId: fcId,
        responseGroupId: rgId,
        fsPath: '/other/file.ts',
        originalStartLine: 10,
        originalEndLine: 12,
        currentStartLine: 10,
        currentEndLine: 12,
        removedLines: ['x'],
        addedLines: ['y'],
        type: 'replacement',
      })

      tracker.recalculate(FILE, 1, 1, 5)

      const hunk = store.getHunk(hunkId)!
      hunk.currentStartLine.should.equal(10) // not affected
    })
  })

  describe('recalculate — multiple hunks stack correctly', () => {
    it('should shift all hunks below edit correctly', () => {
      const h1 = createHunk(10, 12)
      const h2 = createHunk(20, 22)
      const h3 = createHunk(30, 32)

      // Insert 5 lines at line 15
      tracker.recalculate(FILE, 15, 15, 5)

      store.getHunk(h1)!.currentStartLine.should.equal(10) // above, no change
      store.getHunk(h2)!.currentStartLine.should.equal(25) // below, shifted +5
      store.getHunk(h3)!.currentStartLine.should.equal(35) // below, shifted +5
    })

    it('should handle sequential recalculations', () => {
      const hunkId = createHunk(20, 22)

      // First edit: insert 3 lines at line 10
      tracker.recalculate(FILE, 10, 10, 3)
      store.getHunk(hunkId)!.currentStartLine.should.equal(23) // 20 + 3

      // Second edit: insert 2 more at line 5
      tracker.recalculate(FILE, 5, 5, 2)
      store.getHunk(hunkId)!.currentStartLine.should.equal(25) // 23 + 2
    })
  })

  describe('validatePositions', () => {
    it('should find no errors for valid hunks', () => {
      createHunk(5, 10)
      const errors = tracker.validatePositions(FILE, 20)
      errors.should.be.empty()
    })

    it('should report hunk with startLine > file length', () => {
      createHunk(50, 52)
      const errors = tracker.validatePositions(FILE, 10)
      errors.length.should.equal(1)
      errors[0].error.should.containEql('> file length')
    })

    it('should report hunk with endLine < startLine', () => {
      const hunkId = createHunk(10, 8) // invalid: end < start
      const errors = tracker.validatePositions(FILE, 20)
      errors.length.should.equal(1)
      errors[0].hunkId.should.equal(hunkId)
    })
  })
})

import { describe, it, beforeEach } from 'mocha'
import 'should'
import { DiffStore } from '../DiffStore'
import { InMemoryMemento } from '@/test/test-helpers'

describe('DiffStore', () => {
  let store: DiffStore

  beforeEach(() => {
    store = new DiffStore(new InMemoryMemento() as any)
  })

  // ==================== ResponseGroup ====================

  describe('ResponseGroup CRUD', () => {
    it('should create a ResponseGroup with correct fields', () => {
      const id = store.createResponseGroup(1000, 'test description', 'task-1')
      const rg = store.getResponseGroup(id)
      rg!.id.should.equal(id)
      rg!.chatMessageTs.should.equal(1000)
      rg!.description!.should.equal('test description')
      rg!.taskId!.should.equal('task-1')
      rg!.status.should.equal('active')
      rg!.createdAt.should.be.a.Number()
    })

    it('should return undefined for nonexistent RG', () => {
      const rg = store.getResponseGroup('nonexistent')
      ;(rg === undefined).should.be.true()
    })

    it('should update RG status', () => {
      const id = store.createResponseGroup(1000)
      store.updateResponseGroupStatus(id, 'rejected')
      store.getResponseGroup(id)!.status.should.equal('rejected')
    })

    it('should set resolvedAt when status changes to non-active', () => {
      const id = store.createResponseGroup(1000)
      store.updateResponseGroupStatus(id, 'accepted')
      store.getResponseGroup(id)!.resolvedAt!.should.be.a.Number()
    })
  })

  describe('getResponseGroupsFromMessageTs', () => {
    it('should find RGs with chatMessageTs >= target (primary)', () => {
      store.createResponseGroup(100, 'rg1', 'task-1')
      store.createResponseGroup(200, 'rg2', 'task-1')
      store.createResponseGroup(300, 'rg3', 'task-1')

      const groups = store.getResponseGroupsFromMessageTs(200, 'task-1')
      groups.length.should.equal(2) // 200 and 300
      groups[0].chatMessageTs.should.equal(200)
      groups[1].chatMessageTs.should.equal(300)
    })

    it('should sort primary results by chatMessageTs ascending', () => {
      store.createResponseGroup(300, 'rg3', 'task-1')
      store.createResponseGroup(100, 'rg1', 'task-1')
      store.createResponseGroup(200, 'rg2', 'task-1')

      const groups = store.getResponseGroupsFromMessageTs(100, 'task-1')
      groups[0].chatMessageTs.should.equal(100)
      groups[1].chatMessageTs.should.equal(200)
      groups[2].chatMessageTs.should.equal(300)
    })

    it('should fallback to active RGs with chatMessageTs < target', () => {
      store.createResponseGroup(100, 'rg1', 'task-1')

      const groups = store.getResponseGroupsFromMessageTs(200, 'task-1')
      groups.length.should.equal(1) // fallback finds rg1
      groups[0].chatMessageTs.should.equal(100)
    })

    it('should NOT include rejected RGs in fallback', () => {
      const id = store.createResponseGroup(100, 'rg1', 'task-1')
      store.updateResponseGroupStatus(id, 'rejected')

      const groups = store.getResponseGroupsFromMessageTs(200, 'task-1')
      groups.length.should.equal(0) // rejected, not included in fallback
    })

    it('should filter by taskId', () => {
      store.createResponseGroup(100, 'rg1', 'task-1')
      store.createResponseGroup(200, 'rg2', 'task-2')

      const groups = store.getResponseGroupsFromMessageTs(100, 'task-1')
      groups.length.should.equal(1)
      groups[0].taskId!.should.equal('task-1')
    })

    it('should not filter when taskId is undefined', () => {
      store.createResponseGroup(100, 'rg1', 'task-1')
      store.createResponseGroup(200, 'rg2', 'task-2')

      const groups = store.getResponseGroupsFromMessageTs(100)
      groups.length.should.equal(2)
    })

    it('should return empty when nothing matches', () => {
      store.createResponseGroup(100, 'rg1', 'task-1')

      const groups = store.getResponseGroupsFromMessageTs(200, 'task-WRONG')
      groups.length.should.equal(0)
    })
  })

  // ==================== FileChange ====================

  describe('FileChange CRUD', () => {
    it('should create a FileChange', () => {
      const rgId = store.createResponseGroup(1000)
      const fcId = store.createFileChange(rgId, '/test/file.ts', 'modified')
      const fc = store.getFileChange(fcId)
      fc!.id.should.equal(fcId)
      fc!.responseGroupId.should.equal(rgId)
      fc!.fsPath.should.equal('/test/file.ts')
      fc!.kind.should.equal('modified')
      fc!.status.should.equal('pending')
    })

    it('should be idempotent: same (rgId, fsPath) returns same id', () => {
      const rgId = store.createResponseGroup(1000)
      const fc1 = store.createFileChange(rgId, '/test/file.ts', 'modified')
      const fc2 = store.createFileChange(rgId, '/test/file.ts', 'modified')
      fc1.should.equal(fc2)
    })

    it('should return different ids for different files', () => {
      const rgId = store.createResponseGroup(1000)
      const fc1 = store.createFileChange(rgId, '/test/a.ts', 'modified')
      const fc2 = store.createFileChange(rgId, '/test/b.ts', 'modified')
      fc1.should.not.equal(fc2)
    })

    it('should get FileChanges by ResponseGroup', () => {
      const rgId = store.createResponseGroup(1000)
      store.createFileChange(rgId, '/a.ts', 'modified')
      store.createFileChange(rgId, '/b.ts', 'created')

      const fcs = store.getFileChangesByResponseGroup(rgId)
      fcs.length.should.equal(2)
    })
  })

  // ==================== Hunk ====================

  describe('Hunk CRUD', () => {
    let rgId: string
    let fcId: string

    beforeEach(() => {
      rgId = store.createResponseGroup(1000)
      fcId = store.createFileChange(rgId, '/test/file.ts', 'modified')
    })

    function makeHunk(startLine = 10, endLine = 12) {
      return store.createHunk({
        fileChangeId: fcId,
        responseGroupId: rgId,
        fsPath: '/test/file.ts',
        originalStartLine: startLine,
        originalEndLine: endLine,
        currentStartLine: startLine,
        currentEndLine: endLine,
        removedLines: ['old line'],
        addedLines: ['new line'],
        type: 'replacement',
      })
    }

    it('should create a hunk with status pending', () => {
      const id = makeHunk()
      const hunk = store.getHunk(id)
      hunk!.status.should.equal('pending')
      hunk!.fsPath.should.equal('/test/file.ts')
      hunk!.removedLines.should.deepEqual(['old line'])
    })

    it('should return undefined for nonexistent hunk', () => {
      ;(store.getHunk('nonexistent') === undefined).should.be.true()
    })

    it('should update hunk status to accepted', () => {
      const id = makeHunk()
      store.updateHunkStatus(id, 'accepted')
      store.getHunk(id)!.status.should.equal('accepted')
    })

    it('should update hunk status to rejected', () => {
      const id = makeHunk()
      store.updateHunkStatus(id, 'rejected')
      store.getHunk(id)!.status.should.equal('rejected')
    })

    it('should set resolvedAt on non-pending status', () => {
      const id = makeHunk()
      store.updateHunkStatus(id, 'accepted')
      store.getHunk(id)!.resolvedAt!.should.be.a.Number()
    })

    it('should update hunk position', () => {
      const id = makeHunk(10, 12)
      store.updateHunkPosition(id, 15, 17)
      const hunk = store.getHunk(id)!
      hunk.currentStartLine.should.equal(15)
      hunk.currentEndLine.should.equal(17)
    })

    it('should reset RG status to active when new hunk added to rejected RG', () => {
      // Mark RG as rejected
      store.updateResponseGroupStatus(rgId, 'rejected')
      store.getResponseGroup(rgId)!.status.should.equal('rejected')

      // Add new hunk
      makeHunk()

      // RG should be active again
      store.getResponseGroup(rgId)!.status.should.equal('active')
    })

    it('should NOT reset RG status if already active', () => {
      store.getResponseGroup(rgId)!.status.should.equal('active')
      makeHunk()
      store.getResponseGroup(rgId)!.status.should.equal('active') // no change
    })
  })

  describe('Hunk queries', () => {
    let rgId: string

    beforeEach(() => {
      rgId = store.createResponseGroup(1000)
    })

    function addHunkToFile(fsPath: string, status: 'pending' | 'accepted' | 'rejected' = 'pending') {
      const fcId = store.createFileChange(rgId, fsPath, 'modified')
      const id = store.createHunk({
        fileChangeId: fcId,
        responseGroupId: rgId,
        fsPath,
        originalStartLine: 1,
        originalEndLine: 2,
        currentStartLine: 1,
        currentEndLine: 2,
        removedLines: ['x'],
        addedLines: ['y'],
        type: 'replacement',
      })
      if (status !== 'pending') store.updateHunkStatus(id, status)
      return id
    }

    it('getPendingHunksByFile should filter by fsPath and pending status', () => {
      addHunkToFile('/a.ts', 'pending')
      addHunkToFile('/a.ts', 'accepted')
      addHunkToFile('/b.ts', 'pending')

      store.getPendingHunksByFile('/a.ts').length.should.equal(1)
      store.getPendingHunksByFile('/b.ts').length.should.equal(1)
    })

    it('getPendingHunksByFile should be case insensitive', () => {
      addHunkToFile('/Test/File.ts')
      store.getPendingHunksByFile('/test/file.ts').length.should.equal(1)
    })

    it('getPendingHunksByFile should return empty for file with no hunks', () => {
      store.getPendingHunksByFile('/nonexistent.ts').length.should.equal(0)
    })

    it('getHunksByResponseGroup should return all regardless of status', () => {
      addHunkToFile('/a.ts', 'pending')
      addHunkToFile('/b.ts', 'accepted')

      store.getHunksByResponseGroup(rgId).length.should.equal(2)
    })

    it('getPendingCount should count all pending', () => {
      addHunkToFile('/a.ts')
      addHunkToFile('/b.ts')
      addHunkToFile('/c.ts', 'accepted')

      store.getPendingCount().should.equal(2)
    })

    it('hasPendingChangesForFile should return true/false', () => {
      addHunkToFile('/a.ts')

      store.hasPendingChangesForFile('/a.ts').should.be.true()
      store.hasPendingChangesForFile('/b.ts').should.be.false()
    })

    it('getFilesWithPendingChanges should return unique paths', () => {
      addHunkToFile('/a.ts')
      addHunkToFile('/a.ts')
      addHunkToFile('/b.ts')

      const files = store.getFilesWithPendingChanges()
      files.length.should.equal(2)
    })
  })

  // ==================== Bulk operations ====================

  describe('Bulk operations', () => {
    it('clearAll should empty all stores', () => {
      const rgId = store.createResponseGroup(1000)
      const fcId = store.createFileChange(rgId, '/a.ts', 'modified')
      store.createHunk({
        fileChangeId: fcId,
        responseGroupId: rgId,
        fsPath: '/a.ts',
        originalStartLine: 1,
        originalEndLine: 2,
        currentStartLine: 1,
        currentEndLine: 2,
        removedLines: ['x'],
        addedLines: ['y'],
        type: 'replacement',
      })

      store.clearAll()

      store.getPendingCount().should.equal(0)
      ;(store.getResponseGroup(rgId) === undefined).should.be.true()
    })

    it('cleanupOrphanedResponseGroups should remove RGs without pending hunks', () => {
      const rg1 = store.createResponseGroup(100) // no hunks
      const rg2 = store.createResponseGroup(200) // with pending hunk
      const fcId = store.createFileChange(rg2, '/a.ts', 'modified')
      store.createHunk({
        fileChangeId: fcId,
        responseGroupId: rg2,
        fsPath: '/a.ts',
        originalStartLine: 1,
        originalEndLine: 2,
        currentStartLine: 1,
        currentEndLine: 2,
        removedLines: ['x'],
        addedLines: ['y'],
        type: 'replacement',
      })

      store.cleanupOrphanedResponseGroups()

      ;(store.getResponseGroup(rg1) === undefined).should.be.true() // removed
      store.getResponseGroup(rg2)!.should.be.ok() // kept
    })
  })

  // ==================== Events ====================

  describe('Events', () => {
    it('should fire hunkAdded event when hunk is created', (done) => {
      const rgId = store.createResponseGroup(1000)
      const fcId = store.createFileChange(rgId, '/a.ts', 'modified')

      store.onDidChange((event) => {
        if (event.type === 'hunkAdded') {
          event.hunk.fsPath.should.equal('/a.ts')
          done()
        }
      })

      store.createHunk({
        fileChangeId: fcId,
        responseGroupId: rgId,
        fsPath: '/a.ts',
        originalStartLine: 1,
        originalEndLine: 2,
        currentStartLine: 1,
        currentEndLine: 2,
        removedLines: [],
        addedLines: ['new'],
        type: 'addition',
      })
    })

    it('should fire hunkRemoved event when status changes to non-pending', (done) => {
      const rgId = store.createResponseGroup(1000)
      const fcId = store.createFileChange(rgId, '/a.ts', 'modified')
      const hunkId = store.createHunk({
        fileChangeId: fcId,
        responseGroupId: rgId,
        fsPath: '/a.ts',
        originalStartLine: 1,
        originalEndLine: 2,
        currentStartLine: 1,
        currentEndLine: 2,
        removedLines: ['x'],
        addedLines: ['y'],
        type: 'replacement',
      })

      // Subscribe AFTER creation (to skip hunkAdded)
      store.onDidChange((event) => {
        if (event.type === 'hunkRemoved') {
          event.hunkId.should.equal(hunkId)
          done()
        }
      })

      store.updateHunkStatus(hunkId, 'rejected')
    })

    it('should fire hunkPositionChanged event', (done) => {
      const rgId = store.createResponseGroup(1000)
      const fcId = store.createFileChange(rgId, '/a.ts', 'modified')
      const hunkId = store.createHunk({
        fileChangeId: fcId,
        responseGroupId: rgId,
        fsPath: '/a.ts',
        originalStartLine: 1,
        originalEndLine: 2,
        currentStartLine: 1,
        currentEndLine: 2,
        removedLines: ['x'],
        addedLines: ['y'],
        type: 'replacement',
      })

      store.onDidChange((event) => {
        if (event.type === 'hunkPositionChanged') {
          event.hunkId.should.equal(hunkId)
          done()
        }
      })

      store.updateHunkPosition(hunkId, 5, 7)
    })

    it('should fire cleared event', (done) => {
      store.onDidChange((event) => {
        if (event.type === 'cleared') {
          done()
        }
      })
      store.clearAll()
    })
  })
})

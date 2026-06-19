import { describe, it, beforeEach } from 'mocha'
import 'should'
import { SystemEditGuard } from '../SystemEditGuard'

describe('SystemEditGuard', () => {
  let guard: SystemEditGuard

  beforeEach(() => {
    guard = new SystemEditGuard()
  })

  describe('isSystemEdit', () => {
    it('should return false by default', () => {
      guard.isSystemEdit().should.be.false()
    })
  })

  describe('withSystemEdit', () => {
    it('should return true during execution', async () => {
      let duringEdit = false
      await guard.withSystemEdit(async () => {
        duringEdit = guard.isSystemEdit()
      })
      duringEdit.should.be.true()
    })

    it('should return false after completion', async () => {
      await guard.withSystemEdit(async () => {
        // no-op
      })
      guard.isSystemEdit().should.be.false()
    })

    it('should return false after error', async () => {
      try {
        await guard.withSystemEdit(async () => {
          throw new Error('test error')
        })
      } catch {
        // expected
      }
      guard.isSystemEdit().should.be.false()
    })

    it('should return the function result', async () => {
      const result = await guard.withSystemEdit(async () => 42)
      result.should.equal(42)
    })

    it('should handle nested withSystemEdit correctly', async () => {
      await guard.withSystemEdit(async () => {
        guard.isSystemEdit().should.be.true()
        await guard.withSystemEdit(async () => {
          guard.isSystemEdit().should.be.true()
        })
        // After inner completes, outer is still active
        guard.isSystemEdit().should.be.true()
      })
      // After both complete
      guard.isSystemEdit().should.be.false()
    })
  })

  describe('begin / end', () => {
    it('should set isSystemEdit to true after begin', () => {
      const token = guard.begin()
      guard.isSystemEdit().should.be.true()
      guard.end(token)
    })

    it('should set isSystemEdit to false after end', () => {
      const token = guard.begin()
      guard.end(token)
      guard.isSystemEdit().should.be.false()
    })

    it('should handle multiple concurrent tokens', () => {
      const token1 = guard.begin()
      const token2 = guard.begin()
      guard.isSystemEdit().should.be.true()
      guard.end(token1)
      guard.isSystemEdit().should.be.true() // token2 still active
      guard.end(token2)
      guard.isSystemEdit().should.be.false()
    })

    it('should safely handle ending an unknown token', () => {
      guard.end('nonexistent-token')
      guard.isSystemEdit().should.be.false()
    })
  })
})

import { describe, it, beforeEach } from 'mocha'
import 'should'
import { ApprovalGate } from '../ApprovalGate'

describe('ApprovalGate', () => {
  let gate: ApprovalGate

  beforeEach(() => {
    gate = new ApprovalGate()
  })

  describe('normal flow: waitForResponse + handleResponse', () => {
    it('should resolve when handleResponse is called after waitForResponse', async () => {
      const ts = Date.now()
      const promise = gate.waitForResponse(ts, 'test_ask')

      gate.handleResponse('yesButtonClicked', 'hello', [], [], ts)

      const result = await promise
      result.response.should.equal('yesButtonClicked')
      result.text!.should.equal('hello')
    })

    it('should pass all fields through', async () => {
      const ts = Date.now()
      const promise = gate.waitForResponse(ts, 'test_ask')

      gate.handleResponse('messageResponse', 'text', ['img.png'], ['file.ts'], ts)

      const result = await promise
      result.response.should.equal('messageResponse')
      result.text!.should.equal('text')
      result.images!.should.deepEqual(['img.png'])
      result.files!.should.deepEqual(['file.ts'])
    })

    it('should return true when response is handled', () => {
      const ts = Date.now()
      gate.waitForResponse(ts, 'test')
      const handled = gate.handleResponse('yesButtonClicked', undefined, undefined, undefined, ts)
      handled.should.be.true()
    })
  })

  describe('early response (race condition fix)', () => {
    it('should queue response when no pending ask exists', () => {
      const handled = gate.handleResponse('messageResponse', 'early text')
      handled.should.be.true() // queued, not dropped
    })

    it('should deliver early response when waitForResponse is called', async () => {
      // Response arrives BEFORE waitForResponse
      gate.handleResponse('messageResponse', 'early text')

      // Now the ask comes
      const ts = Date.now()
      const result = await gate.waitForResponse(ts, 'resume_task')
      result.response.should.equal('messageResponse')
      result.text!.should.equal('early text')
    })

    it('should deliver multiple early responses in FIFO order', async () => {
      gate.handleResponse('messageResponse', 'first')
      gate.handleResponse('yesButtonClicked', 'second')

      const ts1 = Date.now()
      const result1 = await gate.waitForResponse(ts1, 'ask1')
      result1.text!.should.equal('first')

      const ts2 = Date.now() + 1
      const result2 = await gate.waitForResponse(ts2, 'ask2')
      result2.text!.should.equal('second')
    })

    it('should queue response with specific askTs when no pending ask for that ts', () => {
      const ts = 12345
      const handled = gate.handleResponse('messageResponse', 'text', [], [], ts)
      handled.should.be.true()
    })
  })

  describe('backward compatibility (no askTs)', () => {
    it('should resolve last pending ask when askTs is not provided', async () => {
      const ts = Date.now()
      const promise = gate.waitForResponse(ts, 'test')

      // handleResponse without askTs
      gate.handleResponse('yesButtonClicked', 'no-ts')

      const result = await promise
      result.text!.should.equal('no-ts')
    })
  })

  describe('multiple pending asks', () => {
    it('should reject old pending asks when new one arrives', async () => {
      const ts1 = Date.now()
      const promise1 = gate.waitForResponse(ts1, 'old_ask')

      const ts2 = Date.now() + 100
      gate.waitForResponse(ts2, 'new_ask')

      // old ask should be rejected
      try {
        await promise1
        throw new Error('Should have been rejected')
      } catch (err: any) {
        err.message.should.equal('Current ask promise was ignored')
      }
    })
  })

  describe('rejectAll', () => {
    it('should reject all pending asks', async () => {
      const ts = Date.now()
      const promise = gate.waitForResponse(ts, 'test')

      gate.rejectAll('cancelled')

      try {
        await promise
        throw new Error('Should have been rejected')
      } catch (err: any) {
        err.message.should.equal('cancelled')
      }
    })

    it('should clear early responses', () => {
      gate.handleResponse('messageResponse', 'early')
      gate.rejectAll()
      // After rejectAll, the early response should be gone
      // New waitForResponse should block (not resolve immediately)
      gate.hasPending.should.be.false()
    })
  })

  describe('reject specific ask', () => {
    it('should reject a specific pending ask by ts', async () => {
      const ts = Date.now()
      const promise = gate.waitForResponse(ts, 'test')

      gate.reject(ts, 'superseded')

      try {
        await promise
        throw new Error('Should have been rejected')
      } catch (err: any) {
        err.message.should.equal('superseded')
      }
    })

    it('should not affect other pending asks', async () => {
      const ts1 = Date.now()
      // Note: waitForResponse rejects old asks, so we test with reject()
      const promise1 = gate.waitForResponse(ts1, 'ask1')

      gate.reject(999, 'nonexistent')

      // promise1 should still be pending
      gate.hasPending.should.be.true()

      // Clean up
      gate.rejectAll()
      try { await promise1 } catch { /* expected */ }
    })
  })

  describe('state queries', () => {
    it('hasPending should be false initially', () => {
      gate.hasPending.should.be.false()
    })

    it('hasPending should be true after waitForResponse', () => {
      gate.waitForResponse(Date.now(), 'test')
      gate.hasPending.should.be.true()
    })

    it('hasPending should be false after handleResponse', () => {
      const ts = Date.now()
      gate.waitForResponse(ts, 'test')
      gate.handleResponse('yesButtonClicked', undefined, undefined, undefined, ts)
      gate.hasPending.should.be.false()
    })

    it('pendingCount should track correctly', () => {
      gate.pendingCount.should.equal(0)
      const ts = Date.now()
      gate.waitForResponse(ts, 'test')
      gate.pendingCount.should.equal(1)
    })
  })

  describe('clear', () => {
    it('should silently drop all pending without rejection', () => {
      gate.waitForResponse(Date.now(), 'test')
      gate.handleResponse('messageResponse', 'early')
      gate.clear()
      gate.hasPending.should.be.false()
      gate.pendingCount.should.equal(0)
    })
  })
})

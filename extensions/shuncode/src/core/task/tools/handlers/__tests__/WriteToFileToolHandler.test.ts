import { describe, it } from 'mocha'
import 'should'
import { WriteToFileToolHandler } from '../WriteToFileToolHandler'

/**
 * Tests for WriteToFileToolHandler's diff computation and preview logic.
 * Since computeDiffBlocks and formatBlockPreview are private,
 * we access them via prototype for testing.
 */
describe('WriteToFileToolHandler', () => {
  let handler: any // access private methods

  beforeEach(() => {
    handler = new WriteToFileToolHandler({} as any)
  })

  // ==================== computeDiffBlocks ====================

  describe('computeDiffBlocks', () => {
    it('should detect single line replacement', () => {
      const original = 'line1\nline2\nline3'
      const newContent = 'line1\nCHANGED\nline3'

      const blocks = handler.computeDiffBlocks(original, newContent)
      blocks.length.should.equal(1)
      blocks[0].type.should.equal('replacement')
      blocks[0].removedLines.should.deepEqual(['line2'])
      blocks[0].addedLines.should.deepEqual(['CHANGED'])
    })

    it('should detect deletion', () => {
      const original = 'line1\nline2\nline3'
      const newContent = 'line1\nline3'

      const blocks = handler.computeDiffBlocks(original, newContent)
      blocks.length.should.equal(1)
      blocks[0].type.should.equal('deletion')
      blocks[0].removedLines.should.deepEqual(['line2'])
      blocks[0].addedLines.should.deepEqual([])
    })

    it('should detect addition', () => {
      const original = 'line1\nline3'
      const newContent = 'line1\nline2\nline3'

      const blocks = handler.computeDiffBlocks(original, newContent)
      blocks.length.should.equal(1)
      blocks[0].type.should.equal('addition')
      blocks[0].addedLines.should.deepEqual(['line2'])
    })

    it('should detect multiple changes', () => {
      const original = 'a\nb\nc\nd\ne'
      const newContent = 'a\nB\nc\nD\ne'

      const blocks = handler.computeDiffBlocks(original, newContent)
      blocks.length.should.equal(2)
    })

    it('should normalize CRLF before diffing', () => {
      const original = 'line1\r\nline2\r\nline3'
      const newContent = 'line1\nCHANGED\nline3'

      const blocks = handler.computeDiffBlocks(original, newContent)
      // Should detect only the actual change (line2 → CHANGED), not CRLF differences
      blocks.length.should.equal(1)
      blocks[0].removedLines.should.deepEqual(['line2'])
    })

    it('should return empty for identical content', () => {
      const content = 'line1\nline2\nline3'
      const blocks = handler.computeDiffBlocks(content, content)
      blocks.length.should.equal(0)
    })

    it('should handle empty original (new file)', () => {
      const blocks = handler.computeDiffBlocks('', 'new content')
      blocks.length.should.equal(1)
      blocks[0].type.should.equal('addition')
    })

    it('should handle empty new content (full delete)', () => {
      const blocks = handler.computeDiffBlocks('old content', '')
      blocks.length.should.equal(1)
      blocks[0].type.should.equal('deletion')
    })
  })

  // ==================== formatBlockPreview ====================

  describe('formatBlockPreview', () => {
    it('should format replacement block with +/- prefixes', () => {
      const preview = handler.formatBlockPreview({
        type: 'replacement',
        lineInOldFile: 1,
        lineInNewFile: 1,
        removedLines: ['old line'],
        addedLines: ['new line'],
      })

      preview.should.containEql('-old line')
      preview.should.containEql('+new line')
    })

    it('should format deletion (only - lines)', () => {
      const preview = handler.formatBlockPreview({
        type: 'deletion',
        lineInOldFile: 1,
        lineInNewFile: 1,
        removedLines: ['deleted'],
        addedLines: [],
      })

      preview.should.containEql('-deleted')
      preview.should.not.containEql('+')
    })

    it('should format addition (only + lines)', () => {
      const preview = handler.formatBlockPreview({
        type: 'addition',
        lineInOldFile: 1,
        lineInNewFile: 1,
        removedLines: [],
        addedLines: ['added'],
      })

      preview.should.containEql('+added')
      preview.should.not.containEql('-')
    })

    it('should strip trailing \\r from lines', () => {
      const preview = handler.formatBlockPreview({
        type: 'replacement',
        lineInOldFile: 1,
        lineInNewFile: 1,
        removedLines: ['line\r'],
        addedLines: ['new\r'],
      })

      preview.should.not.containEql('\r')
    })

    it('should handle multi-line blocks', () => {
      const preview = handler.formatBlockPreview({
        type: 'replacement',
        lineInOldFile: 1,
        lineInNewFile: 1,
        removedLines: ['old1', 'old2'],
        addedLines: ['new1', 'new2', 'new3'],
      })

      const lines = preview.split('\n')
      lines.length.should.equal(5) // 2 removed + 3 added
    })
  })

  // ==================== Bad AI input ====================

  describe('Bad AI input for diff computation', () => {
    it('should handle AI stripping all indentation', () => {
      const original = '  function foo() {\n    return 1;\n  }'
      const newContent = 'function foo() {\nreturn 1;\n}'

      const blocks = handler.computeDiffBlocks(original, newContent)
      blocks.length.should.be.greaterThan(0) // Should detect changes
    })

    it('should handle AI sending identical content (no-op)', () => {
      const content = 'const x = 1;\nconst y = 2;'
      const blocks = handler.computeDiffBlocks(content, content)
      blocks.length.should.equal(0)
    })

    it('should handle AI sending content with only whitespace differences', () => {
      const original = 'line1\nline2\nline3'
      const newContent = 'line1\nline2 \nline3' // trailing space on line2

      const blocks = handler.computeDiffBlocks(original, newContent)
      blocks.length.should.equal(1) // Should detect the whitespace change
    })

    it('should handle very large diff (200 lines changed)', () => {
      const original = Array.from({ length: 200 }, (_, i) => `line${i}`).join('\n')
      const newContent = Array.from({ length: 200 }, (_, i) => `CHANGED${i}`).join('\n')

      const blocks = handler.computeDiffBlocks(original, newContent)
      blocks.length.should.be.greaterThan(0)
    })
  })
})

import { describe, it, before } from 'mocha'
import 'should'
import * as path from 'path'
import * as fs from 'fs'
import { SyntaxValidator } from '../SyntaxValidator'

/**
 * SyntaxValidator unit tests.
 *
 * Uses REAL tree-sitter WASM parsers from dist/ directory.
 * Tests actual syntax validation — no mocks, no hardcoded results.
 */
describe('SyntaxValidator', () => {
  let validator: SyntaxValidator
  const WASM_DIR = path.join(__dirname, '..', '..', '..', '..', 'dist')

  before(async function () {
    this.timeout(10000) // WASM loading can be slow

    // Verify WASM files exist
    const treeSitterWasm = path.join(WASM_DIR, 'tree-sitter.wasm')
    if (!fs.existsSync(treeSitterWasm)) {
      console.warn(`[SyntaxValidator.test] tree-sitter.wasm not found at ${treeSitterWasm}, skipping tests`)
      this.skip()
    }

    validator = SyntaxValidator.createForTest(WASM_DIR)
    await validator.initialize()
  })

  // ==================== TypeScript validation ====================

  describe('TypeScript', () => {
    it('should validate correct TypeScript code', async () => {
      const code = `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

interface User {
  id: number;
  name: string;
  email?: string;
}

const users: User[] = [];
`
      const result = await validator.validate('test.ts', code)
      result.valid.should.be.true()
      result.errors.should.have.length(0)
      result.language!.should.equal('typescript')
    })

    it('should detect missing closing brace in TypeScript', async () => {
      const code = `
function broken() {
  const x = 1;
  if (x > 0) {
    console.log(x);

`
      const result = await validator.validate('test.ts', code)
      result.valid.should.be.false()
      result.errors.length.should.be.greaterThan(0)
    })

    it('should detect unexpected token in TypeScript', async () => {
      const code = `
function test() {
  const x = ;;;
}
`
      const result = await validator.validate('test.ts', code)
      result.valid.should.be.false()
      result.errors.length.should.be.greaterThan(0)
    })

    it('should handle complex TypeScript generics correctly', async () => {
      const code = `
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

async function fetchData<T>(url: string): Promise<Result<T, Error>> {
  try {
    const res = await fetch(url);
    const data = await res.json() as T;
    return { ok: true, value: data };
  } catch (e) {
    return { ok: false, error: e as Error };
  }
}
`
      const result = await validator.validate('test.ts', code)
      result.valid.should.be.true()
      result.errors.should.have.length(0)
    })
  })

  // ==================== JavaScript validation ====================

  describe('JavaScript', () => {
    it('should validate correct JavaScript code', async () => {
      const code = `
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ message: 'Hello World' });
});

module.exports = app;
`
      const result = await validator.validate('test.js', code)
      result.valid.should.be.true()
      result.errors.should.have.length(0)
      result.language!.should.equal('javascript')
    })

    it('should detect unterminated string literal', async () => {
      const code = `
const msg = "hello
const x = 1;
`
      const result = await validator.validate('test.js', code)
      result.valid.should.be.false()
      result.errors.length.should.be.greaterThan(0)
    })
  })

  // ==================== Python validation ====================

  describe('Python', () => {
    it('should validate correct Python code', async () => {
      const code = `
def greet(name: str) -> str:
    return f"Hello, {name}!"

class User:
    def __init__(self, name: str, age: int):
        self.name = name
        self.age = age

    def __repr__(self) -> str:
        return f"User({self.name}, {self.age})"

users = [User("Alice", 30), User("Bob", 25)]
`
      const result = await validator.validate('test.py', code)
      result.valid.should.be.true()
      result.errors.should.have.length(0)
      result.language!.should.equal('python')
    })
  })

  // ==================== Change validation ====================

  describe('validateChange', () => {
    it('should allow change that fixes syntax errors', async () => {
      const original = `
function broken() {
  const x = 1;
  if (x > 0) {
    console.log(x);

`
      const fixed = `
function broken() {
  const x = 1;
  if (x > 0) {
    console.log(x);
  }
}
`
      const result = await validator.validateChange('test.ts', original, fixed)
      result.canApply.should.be.true()
      result.addedErrors.should.have.length(0)
    })

    it('should detect change that introduces new errors', async () => {
      const original = `
function working() {
  const x = 1;
  return x + 2;
}
`
      const broken = `
function working() {
  const x = 1;
  return x +
}
`
      const result = await validator.validateChange('test.ts', original, broken)
      result.valid.should.be.false()
      result.addedErrors.length.should.be.greaterThan(0)
      result.canApply.should.be.false()
    })

    it('should allow change that does not add errors to already broken code', async () => {
      const original = `
function a() {
  const x = ;;;
}

function b() {
  return 1;
}
`
      // Fix function b (minor change) but leave function a broken
      const modified = `
function a() {
  const x = ;;;
}

function b() {
  return 42;
}
`
      const result = await validator.validateChange('test.ts', original, modified)
      // Same number of errors or fewer → canApply = true
      result.canApply.should.be.true()
    })

    it('should block change that adds more errors to already broken code', async () => {
      const original = `
function a() {
  const x = ;;;
}

function b() {
  return 1;
}
`
      // Break function b too
      const moreBroken = `
function a() {
  const x = ;;;
}

function b() {
  return +++
}
`
      const result = await validator.validateChange('test.ts', original, moreBroken)
      result.canApply.should.be.false()
      result.addedErrors.length.should.be.greaterThan(0)
    })
  })

  // ==================== Unsupported languages ====================

  describe('Unsupported languages', () => {
    it('should return valid for unknown file types', async () => {
      const result = await validator.validate('test.xyz', 'totally broken syntax {{{')
      result.valid.should.be.true()
      result.errors.should.have.length(0)
      ;(result.language === null).should.be.true()
    })

    it('should return valid for .txt files', async () => {
      const result = await validator.validate('readme.txt', 'not code')
      result.valid.should.be.true()
    })

    it('should return valid for .md files', async () => {
      const result = await validator.validate('README.md', '# Title\n\nSome content')
      result.valid.should.be.true()
    })
  })

  // ==================== Error formatting ====================

  describe('formatErrorsForModel', () => {
    it('should format errors concisely', async () => {
      const code = `
function broken() {
  const x = ;;;
  const y = +++
}
`
      const result = await validator.validate('test.ts', code)
      const formatted = validator.formatErrorsForModel(result.errors)
      formatted.should.be.a.String()
      formatted.length.should.be.greaterThan(0)
      formatted.should.containEql('Line')
    })

    it('should return empty string for no errors', () => {
      const formatted = validator.formatErrorsForModel([])
      formatted.should.equal('')
    })

    it('should truncate beyond 5 errors', async () => {
      // Create code with many errors
      const code = `
const a = ;;;
const b = ;;;
const c = ;;;
const d = ;;;
const e = ;;;
const f = ;;;
const g = ;;;
`
      const result = await validator.validate('test.ts', code)
      if (result.errors.length > 5) {
        const formatted = validator.formatErrorsForModel(result.errors)
        formatted.should.containEql('more errors')
      }
    })
  })

  // ==================== Edge cases ====================

  describe('Edge cases', () => {
    it('should handle empty file', async () => {
      const result = await validator.validate('test.ts', '')
      result.valid.should.be.true()
      result.errors.should.have.length(0)
    })

    it('should handle single line of code', async () => {
      const result = await validator.validate('test.ts', 'const x = 1;')
      result.valid.should.be.true()
    })

    it('should handle very long file', async () => {
      // Generate 500 lines of valid TypeScript
      const lines = Array.from({ length: 500 }, (_, i) => `const var${i} = ${i};`)
      const code = lines.join('\n')
      const result = await validator.validate('test.ts', code)
      result.valid.should.be.true()
    })

    it('should handle file with only comments', async () => {
      const code = `
// This is a comment
/* This is a
   multi-line comment */
// Another comment
`
      const result = await validator.validate('test.ts', code)
      result.valid.should.be.true()
    })

    it('should handle TSX code', async () => {
      const code = `
import React from 'react';

interface Props {
  name: string;
}

export const Hello: React.FC<Props> = ({ name }) => {
  return <div className="greeting">Hello, {name}!</div>;
};
`
      const result = await validator.validate('test.tsx', code)
      result.valid.should.be.true()
      result.language!.should.equal('tsx')
    })

    it('should handle JSX code', async () => {
      const code = `
function App() {
  return (
    <div>
      <h1>Hello</h1>
      <p>World</p>
    </div>
  );
}
`
      const result = await validator.validate('test.jsx', code)
      result.valid.should.be.true()
    })
  })
})

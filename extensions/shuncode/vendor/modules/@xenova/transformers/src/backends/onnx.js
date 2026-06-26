/**
 * @file Handler file for ONNX Runtime backend.
 *
 * [SHUNCODE] Modified: use onnxruntime-node with DirectML GPU acceleration.
 * We run in VS Code extension host (Node.js), so the native backend
 * is the right choice. DirectML provides GPU acceleration on Windows
 * with no CUDA toolkit required. Falls back to CPU if DirectML is unavailable.
 *
 * @module backends/onnx
 */

import * as ONNX_NODE from "onnxruntime-node";

/** @type {import('onnxruntime-node')} The ONNX runtime module. */
export let ONNX;

export const executionProviders = [
  "dml",
  "cpu",
];

ONNX = ONNX_NODE.default ?? ONNX_NODE;

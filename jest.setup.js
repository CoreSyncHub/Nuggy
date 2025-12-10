// Import reflect-metadata first (required by tsyringe)
require('reflect-metadata');

// Mock vscode module
const vscode = {
  workspace: {
    findFiles: jest.fn(),
    fs: {
      readFile: jest.fn(),
    },
  },
  Uri: {
    file: jest.fn((path) => ({ fsPath: path })),
  },
};

// Mock the vscode module
jest.mock('vscode', () => vscode, { virtual: true });

// Minimal Node globals used in the browser build
// Provides process.env typing without pulling full @types/node if not installed
interface ProcessEnv {
  [key: string]: string | undefined;
}
interface Process {
  env: ProcessEnv;
}
declare const process: Process;

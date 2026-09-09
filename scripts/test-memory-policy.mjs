// A hosted quality gate shares its container with npm and the test-runner
// parent. Do not fan out multiple high-resolution image test processes on
// a small host, or tests can trigger the same container OOM they guard against.
export function memoryBoundedTestArguments(args, constrainedBytes = process.constrainedMemory?.()) {
  if (args.some((argument) => argument === "--test-concurrency" || argument.startsWith("--test-concurrency="))) {
    return args;
  }
  const limit = Number(constrainedBytes);
  return Number.isFinite(limit) && limit > 0 && limit <= 4 * 1024 ** 3
    ? ["--test-concurrency=1", ...args] : args;
}

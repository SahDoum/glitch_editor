const [major, minor] = process.versions.node.split(".").map(Number);
const isSupportedNode =
  (major === 20 && minor >= 19) ||
  (major !== undefined && major >= 22 && (major > 22 || minor >= 12));

if (!isSupportedNode) {
  console.error(
    `This project requires Node.js 20.19+ or 22.12+. Current version: ${process.version}.\n` +
      "If you use nvm, run `nvm install && nvm use`, then rerun the command.",
  );
  process.exitCode = 1;
}

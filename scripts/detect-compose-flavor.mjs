import { spawnSync } from "node:child_process";

const canRun = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    windowsHide: true
  });

  return result.status === 0;
};

if (canRun("docker", ["compose", "version"])) {
  console.log("plugin");
} else if (canRun("docker-compose", ["version"])) {
  console.log("legacy");
} else {
  console.log("plugin");
}
